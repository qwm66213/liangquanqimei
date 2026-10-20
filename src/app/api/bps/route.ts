import { NextRequest, NextResponse } from "next/server";
import {
  buildInboundRemark,
  parseBpsMessage,
  statInbound,
  type BpsMessage,
  type InboundHistoryRow,
  type ParsedInbound,
} from "@/lib/bps-parser";
import { getBpsApp } from "@/lib/bps-config";
import { fetchInboundByPoNo } from "@/lib/bps-history";
import { appendRequestLog } from "@/lib/bps-log";
import { pollInboundResult, submitInbound } from "@/lib/bps-inbound";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 本接口为主流程入口，固定写入主流程应用 e04doio3ps02 */
const cfg = getBpsApp();

/** 统一响应格式（对齐轻流 openAPI）：errCode / errMsg / result */
function okResponse(result: Record<string, unknown>) {
  return NextResponse.json({ errCode: 0, errMsg: null, result });
}

function errResponse(errCode: number, errMsg: string, httpStatus = 200) {
  return NextResponse.json({ errCode, errMsg, result: null }, { status: httpStatus });
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 解析失败时的空结果（用于兜底日志，保证 messageId/poNo 可追溯） */
function emptyParsed(msg: BpsMessage): ParsedInbound {
  return {
    messageId: String(msg.id ?? ""),
    poNo: String(msg.customerNo ?? ""),
    answers: [],
    itemCount: 0,
  };
}

/**
 * 兜底转发：把原始报文发给轻流 Q-Source，由 Q-Source 配置自行解析入库。
 * 内部捕获网络/HTTP 异常，不向外抛出。
 */
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
    return { ok: false, status: 0, body: errMsg(error) };
  }
}

/**
 * 兜底统一处理：转发原始报文给 Q-Source → 记日志 → 返回顺丰响应。
 * Q-Source 成功 code=0；Q-Source 也失败 code=1、msg=处理失败（不向顺丰回传内部细节）。
 */
async function fallbackAndRespond(
  raw: unknown,
  msg: BpsMessage,
  parsed: ParsedInbound,
  reason: string,
): Promise<NextResponse> {
  if (!cfg.qsourceUrl) {
    // Q-Source 地址未配置（需环境变量 QSOURCE_RECEIVE_URL_2）：不转发，直接失败并记录
    await appendRequestLog({
      messageId: parsed.messageId,
      poNo: parsed.poNo,
      outcome: "fallback_qsource_failed",
      detail: `${reason}; qsource skipped: QSOURCE_RECEIVE_URL_2 not configured`,
      raw,
    });
    return errResponse(1, "处理失败");
  }
  const fb = await fallbackToQSource(msg, cfg.qsourceUrl);
  await appendRequestLog({
    messageId: parsed.messageId,
    poNo: parsed.poNo,
    outcome: fb.ok ? "fallback_qsource_ok" : "fallback_qsource_failed",
    detail: `${reason}; qsource HTTP ${fb.status}: ${fb.body.slice(0, 500)}`,
    raw,
  });
  if (fb.ok) {
    return okResponse({ requestId: "" });
  }
  return errResponse(1, "处理失败");
}

/**
 * 主流程：收到顺丰请求后【先走我们自己的解析 + 写入链路】，
 * 任何环节失败（解析失败 / 提交失败 / 轮询失败）则【兜底交给轻流 Q-Source】。
 *
 * 整单入库判定：同一采购单分批发货时，第二次/补发报文里的 items[].planQty 仍是全单计划，
 * 需先按 poNo 查询该单已入库的历史单据，叠加本次实收后再判定整单状态。
 */
async function processInbound(raw: unknown, msg: BpsMessage): Promise<NextResponse> {
  // 0) 按采购单号查询历史入库单据（累计判定用；查询失败不阻断主链路，按无历史处理）
  const cpo = (msg.custPurchaseOrder ?? {}) as Record<string, unknown>;
  const poNo = String(cpo.code ?? msg.customerNo ?? "");
  let history: InboundHistoryRow[] = [];
  if (poNo) {
    try {
      history = await fetchInboundByPoNo(poNo, {
        appKey: cfg.appKey,
        fields: cfg.fields,
      });
    } catch (error) {
      console.warn(
        `[bps] history query failed, fallback to current-message only: ${errMsg(error)}`,
      );
      history = [];
    }
  }

  // 1) 解析报文（备注字段按累计实收判定：全部入库 / 部分入库）
  let parsed: ParsedInbound;
  try {
    parsed = parseBpsMessage(msg, cfg.fields, history);
  } catch (error) {
    return await fallbackAndRespond(raw, msg, emptyParsed(msg), `parse error: ${errMsg(error)}`);
  }
  if (parsed.answers.length === 0) {
    // 解析不出任何字段：说明是陌生报文结构，直接兜底交给 Q-Source
    return await fallbackAndRespond(raw, msg, parsed, "parse empty");
  }

  // 2) 提交 + 轮询
  try {
    const submitted = await submitInbound(msg, {
      appKey: cfg.appKey,
      fields: cfg.fields,
      history,
    });
    const polled = await pollInboundResult(submitted.requestId);
    if (polled.errorCode !== 0) {
      // 提交成功但轮询结果异常（轻流侧校验失败等）：兜底给 Q-Source
      return await fallbackAndRespond(
        raw,
        msg,
        {
          messageId: submitted.messageId,
          poNo: submitted.poNo,
          answers: parsed.answers,
          itemCount: parsed.itemCount,
        },
        `submit/poll failed: requestId=${submitted.requestId} error=${polled.message ?? ""}`,
      );
    }

    // 3) 整单累计入库状态 → 决定返回体（备注字段已按累计写入轻流）
    const stat = statInbound(msg, history);
    const remark = buildInboundRemark(msg, history);
    await appendRequestLog({
      messageId: submitted.messageId,
      poNo: submitted.poNo,
      outcome: stat.isPartial ? "submitted_partial" : "submitted",
      detail: `applyId=${polled.applyId ?? ""}; remark=${remark.replace(/\n/g, " / ")}`,
      raw,
    });
    if (!stat.isPartial) {
      // 累计已补齐：正常返回
      return okResponse({ requestId: submitted.requestId });
    }
    // 仍缺：errCode 2 + 少发明细（对齐 _simulate_bps_inbound.ts 返回体）
    return NextResponse.json({
      errCode: 2,
      errMsg: "部分入库",
      result: {
        requestId: submitted.requestId,
        remark,
        shortItems: stat.shortItems,
      },
    });
  } catch (error) {
    // 提交/轮询抛异常（网络、轻流 5xx 等）：兜底给 Q-Source
    return await fallbackAndRespond(raw, msg, parsed, `submit error: ${errMsg(error)}`);
  }
}

/**
 * 顺丰 BPS 入库报文二开接入点（主流程应用 e04doio3ps02，替代 Q-Source 被动模式）
 *
 * POST /api/bps
 * Body: 顺丰 BPS 入库报文 JSON（兼容外层包装：data/content/payload/message）
 *
 * 流程：先走我们自己的解析 + 写入；失败则兜底转发轻流 Q-Source。
 * 安全：
 *  - 若配置了环境变量 BPS_ACCESS_TOKEN，则请求头必须携带
 *    Authorization: Bearer <token> 或 X-BPS-Token: <token>
 */
export async function POST(request: NextRequest) {
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
  let msg: BpsMessage;
  try {
    raw = await request.json();

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
    msg = msgObj as BpsMessage;
    if (!Array.isArray(msg.batchItems) || msg.batchItems.length === 0) {
      return errResponse(400, "batchItems is required and must be a non-empty array", 400);
    }
  } catch (error) {
    if (raw === undefined) return errResponse(400, "Invalid JSON body", 400);
    console.error("[bps] request parse error:", errMsg(error));
    return errResponse(500, "Internal server error", 500);
  }

  try {
    return await processInbound(raw, msg);
  } catch (error) {
    // 兜底本身也异常（如日志写入失败等）时的最后防线
    console.error("[bps] inbound error:", errMsg(error));
    return errResponse(500, "Internal server error", 500);
  }
}
