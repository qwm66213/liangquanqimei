/**
 * 轻流 openAPI 写入模块（二开替代 Q-Source 回传）
 *
 * 职责：
 * 1. 将解析好的 answers 通过 openAPI 写入目标应用 e04doio3ps02（主流程，默认）
 * 2. 轮询 /operation/{requestId} 确认写入结果
 */

import {
  buildApplyBody,
  parseBpsMessage,
  type BpsFieldConfig,
  type BpsMessage,
  type InboundHistoryRow,
} from "./bps-parser";
import { DEFAULT_BPS_APP_KEY } from "./bps-config";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/** 默认目标应用：主流程应用（e04doio3ps02） */
function appKey(): string {
  return DEFAULT_BPS_APP_KEY;
}

/** 多应用写入选项：可显式指定目标应用与字段配置（不传则走默认应用） */
export type InboundOptions = {
  appKey?: string;
  fields?: BpsFieldConfig;
  /** 该采购单历史单据明细（整单累计判定：备注字段按累计实收生成） */
  history?: InboundHistoryRow[];
};

function resolveAppKey(opt?: InboundOptions): string {
  return opt?.appKey ?? appKey();
}

function accessToken(): string {
  const token = env("QINGFLOW_ACCESS_TOKEN");
  if (!token) throw new Error("Missing env: QINGFLOW_ACCESS_TOKEN");
  return token;
}

function baseUrl(): string {
  return env("QINGFLOW_BASE_URL", "https://api.qingflow.com");
}

type QingflowApiResponse = {
  errCode: number;
  errMsg?: string | null;
  result?: {
    requestId?: string;
    applyId?: string;
    result?: unknown;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
};

/** 写入轻流，返回 requestId（需要进一步轮询） */
export async function submitInbound(
  msg: BpsMessage,
  opt?: InboundOptions,
): Promise<{
  requestId: string;
  messageId: string;
  poNo: string;
  itemCount: number;
}> {
  const body = buildApplyBody(msg, opt?.fields, opt?.history);
  const parsed = parseBpsMessage(msg, opt?.fields, opt?.history);

  const response = await fetch(`${baseUrl()}/app/${resolveAppKey(opt)}/apply`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      accessToken: accessToken(),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  let data: QingflowApiResponse;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { errCode: -1, errMsg: text };
  }

  if (!response.ok || data.errCode !== 0) {
    throw new Error(
      `Qingflow apply failed (HTTP ${response.status}, errCode ${data.errCode}): ${data.errMsg ?? text}`,
    );
  }

  const requestId = data.result?.requestId;
  if (!requestId) {
    throw new Error(`Qingflow apply returned no requestId: ${text}`);
  }

  return {
    requestId,
    messageId: parsed.messageId,
    poNo: parsed.poNo,
    itemCount: parsed.itemCount,
  };
}

/** 轮询写入结果，最多 pollTimes 次，每次间隔 pollIntervalMs */
export async function pollInboundResult(
  requestId: string,
  pollTimes = 5,
  pollIntervalMs = 3000,
): Promise<{ applyId?: string; errorCode: number; message?: string }> {
  for (let i = 0; i < pollTimes; i++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const response = await fetch(`${baseUrl()}/operation/${requestId}`, {
      headers: { Accept: "application/json", accessToken: accessToken() },
      cache: "no-store",
    });
    const text = await response.text();
    let data: { errorCode?: number; message?: string; result?: unknown } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (data.errorCode === 0) {
      const applyId = Array.isArray(data.result)
        ? String(data.result[0])
        : String(data.result ?? "");
      return { applyId, errorCode: 0, message: "" };
    }
    if (data.errorCode !== undefined && data.errorCode !== null) {
      return {
        errorCode: data.errorCode,
        message: data.message ?? `poll errorCode=${data.errorCode}`,
      };
    }
  }
  return { errorCode: -1, message: `poll timeout after ${pollTimes} tries` };
}

