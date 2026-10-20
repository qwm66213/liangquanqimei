/**
 * 【已停用】BPS 测试应用入口（原目标应用 fgaeqpu8go02 已停止使用）。
 * 本接口原为 /api/bps 的测试实现，随路由调整迁至此处，原实现整体注释保留（不删除）。
 * 当前唯一在用的入口为 /api/bps（主流程应用 e04doio3ps02）。
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 已停用：测试应用 fgaeqpu8go02 不再接收业务请求 */
export async function POST() {
  return NextResponse.json(
    {
      errCode: 410,
      errMsg: "fgaeqpu8go02 测试应用已停用，请走 /api/bps",
      result: null,
    },
    { status: 410 },
  );
}

/* ================= 原实现（fgaeqpu8go02 测试应用，已停用）================= */
/*
import { NextRequest, NextResponse } from "next/server";
import { parseBpsMessage, type BpsMessage } from "@/lib/bps-parser";
import { TEST_BPS_APP_KEY, getBpsApp } from "@/lib/bps-config";
import { appendRequestLog } from "@/lib/bps-log";
import {
  findExistingByMessageId,
  pollInboundResult,
  submitInbound,
} from "@/lib/bps-inbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/ ** 本接口固定写入测试应用 fgaeqpu8go02（主流程请走 /api/bps） * /
const cfg = getBpsApp(TEST_BPS_APP_KEY);

/ ** 统一响应格式（对齐轻流 openAPI）：errCode / errMsg / result * /
function okResponse(result: Record<string, unknown>) {
  return NextResponse.json({ errCode: 0, errMsg: null, result });
}

function errResponse(errCode: number, errMsg: string, httpStatus = 200) {
  return NextResponse.json({ errCode, errMsg, result: null }, { status: httpStatus });
}

/ **
 * 回退：自定义解析失败时，把原始报文转发给轻流 Q-Source，由 Q-Source 配置自行解析入库。
 * /
async function fallbackToQSource(raw: unknown, url: string): Promise<{
  ok: boolean;
  status: number;
  body: string;
}> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const token = process.env.QINGFLOW_ACCESS_TOKEN;
  if (token) headers.accessToken = token;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(raw),
      cache: "no-store",
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

/ **
 * 顺丰 BPS 入库报文二开接入点（替代 Q-Source 被动模式）
 *
 * POST /api/bps2
 * Body: 顺丰 BPS 入库报文 JSON（兼容外层包装：data/content/payload/message）
 *
 * 安全：
 *  - 若配置了环境变量 BPS_ACCESS_TOKEN，则请求头必须携带
 *    Authorization: Bearer <token> 或 X-BPS-Token: <token>
 *  - 幂等：按报文 messageId 查重，已入库则跳过
 * /
export async function POST(request: NextRequest) {
  try {
    const configuredToken = process.env.BPS_ACCESS_TOKEN;
    if (configuredToken) {
      const auth = request.headers.get("authorization") ?? "";
      const xToken = request.headers.get("x-bps-token") ?? "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (bearer !== configuredToken && xToken !== configuredToken) {
        return errResponse(401, "Unauthorized", 401);
      }
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return errResponse(400, "Invalid JSON body", 400);
    }

    // 兼容外层包装：直接是报文，或包在 {data|content|payload|message}
    const unwrap = (obj: Record<string, unknown>): Record<string, unknown> | null => {
      for (const key of ["data", "content", "payload", "message"]) {
        const v = obj[key];
        if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
      }
      return null;
    };

    let msgObj = raw as Record<string, unknown>;
    if (!Array.isArray(msgObj.batchItems)) {
      const inner = unwrap(msgObj);
      if (inner && Array.isArray(inner.batchItems)) msgObj = inner;
    }

    const msg = msgObj as BpsMessage;
    if (!Array.isArray(msg.batchItems) || msg.batchItems.length === 0) {
      return errResponse(400, "batchItems is required and must be a non-empty array", 400);
    }

    const parsed = parseBpsMessage(msg, cfg.fields);
    if (parsed.answers.length === 0) {
      // 自定义解析失败：自动回退，转发原始报文给轻流 Q-Source 解析入库。
      // 回退成功 code=0；回退也失败 code=1、msg=解析失败（不向顺丰回传内部细节）。
      const fb = await fallbackToQSource(msg, cfg.qsourceUrl);
      await appendRequestLog({
        messageId: parsed.messageId,
        poNo: parsed.poNo,
        outcome: fb.ok ? "fallback_qsource_ok" : "fallback_qsource_failed",
        detail: `parse failed; qsource HTTP ${fb.status}: ${fb.body.slice(0, 500)}`,
        raw,
      });
      if (fb.ok) {
        return okResponse({ requestId: "" });
      }
      return errResponse(1, "解析失败");
    }

    // 幂等查重
    const existing = await findExistingByMessageId(parsed.messageId, {
      appKey: cfg.appKey,
      fields: cfg.fields,
    });
    if (existing.exists) {
      await appendRequestLog({
        messageId: parsed.messageId,
        poNo: parsed.poNo,
        outcome: "duplicated",
        detail: `applyId=${existing.applyId ?? ""}`,
        raw,
      });
      return okResponse({ requestId: "" });
    }

    const submitted = await submitInbound(msg, {
      appKey: cfg.appKey,
      fields: cfg.fields,
    });

    const polled = await pollInboundResult(submitted.requestId);
    if (polled.errorCode !== 0) {
      await appendRequestLog({
        messageId: submitted.messageId,
        poNo: submitted.poNo,
        outcome: "failed",
        detail: `submit requestId=${submitted.requestId} error=${polled.message ?? ""}`,
        raw,
      });
      return errResponse(502, "submit failed", 502);
    }

    await appendRequestLog({
      messageId: submitted.messageId,
      poNo: submitted.poNo,
      outcome: "submitted",
      detail: `applyId=${polled.applyId ?? ""}`,
      raw,
    });

    return okResponse({ requestId: submitted.requestId });
  } catch (error) {
    console.error("[bps] inbound error:", error instanceof Error ? error.message : error);
    return errResponse(500, "Internal server error", 500);
  }
}
*/
