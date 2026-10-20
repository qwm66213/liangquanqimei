import { NextRequest, NextResponse } from "next/server";
import { issueTicket } from "@/lib/purchase-auth";
import { rateLimit } from "@/lib/purchase-api";
import { getBinding } from "@/lib/purchase-bindings";
import {
  fetchQingflowUser,
  isInternalAllowed,
  maskMobile,
  resolveCustomerByIdentity,
} from "@/lib/purchase-identity";

export const dynamic = "force-dynamic";

type SessionBody = {
  extUserId?: string | number;
  wsId?: string | number;
  ts?: string | number;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function expectedWsId(): string {
  return (process.env.PURCHASE_QF_WS_ID ?? "180750").trim();
}

function timestampWindowMs(): number {
  const minutes = Number(process.env.PURCHASE_QF_TS_WINDOW_MINUTES ?? "30");
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;
}

/**
 * POST /api/purchase/session
 * 用轻流门户带上来的 qfExtUserId / qfWsId / qfTimestamp 换取二开侧会话：
 *   - 已绑定（未过期）→ 直接签发会话票据
 *   - 未绑定 → 查轻流用户：
 *       命中内部白名单（用户 ID / 角色 ID）→ 内部账号（可见全量），需首次验证
 *       否则按「手机号优先、姓名兜底」匹配客户档案 → 客户账号（仅本门店），需首次验证
 *       两者都不命中 → 403 拒绝
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as SessionBody;
    const url = new URL(request.url);
    const extUserId = String(body.extUserId ?? url.searchParams.get("extUserId") ?? "").trim();
    const wsId = String(body.wsId ?? url.searchParams.get("wsId") ?? "").trim();
    const ts = String(body.ts ?? url.searchParams.get("ts") ?? "").trim();

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (!rateLimit(`session:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    }

    if (!/^\d+$/.test(extUserId)) {
      return NextResponse.json({ error: "identity_missing" }, { status: 400 });
    }

    const ws = expectedWsId();
    if (ws && wsId && ws !== wsId) {
      return NextResponse.json({ error: "workspace_mismatch" }, { status: 403 });
    }

    if (ts) {
      const tsNum = Number(ts);
      if (Number.isFinite(tsNum) && Math.abs(Date.now() - tsNum) > timestampWindowMs()) {
        return NextResponse.json({ error: "ticket_expired" }, { status: 403 });
      }
    }

    const binding = await getBinding(extUserId);
    if (binding) {
      return NextResponse.json({
        ok: true,
        verified: true,
        role: binding.role,
        token: issueTicket({
          role: binding.role,
          storeName: binding.role === "customer" ? binding.storeName : undefined,
          customerLabel: binding.role === "customer" ? binding.customerLabel ?? undefined : undefined,
          ttlMs: SESSION_TTL_MS,
        }),
        storeName: binding.storeName ?? null,
        customerLabel: binding.customerLabel ?? null,
        displayName: binding.displayName ?? null,
      });
    }

    const user = await fetchQingflowUser(extUserId);
    if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

    if (isInternalAllowed(user)) {
      return NextResponse.json({
        ok: true,
        verified: false,
        needVerify: true,
        role: "admin",
        storeName: null,
        displayName: user.name,
        mobileMask: maskMobile(user.mobileNum),
      });
    }

    const customer = await resolveCustomerByIdentity({ mobile: user.mobileNum, name: user.name });
    if (!customer || !customer.storeName) {
      return NextResponse.json(
        { error: "no_customer_profile", name: user.name, mobileMask: maskMobile(user.mobileNum) },
        { status: 403 },
      );
    }

    return NextResponse.json({
      ok: true,
      verified: false,
      needVerify: true,
      role: "customer",
      storeName: customer.storeName,
      customerLabel: customer.customerLabel ?? null,
      displayName: user.name,
      mobileMask: maskMobile(user.mobileNum),
      matchedBy: customer.matchedBy ?? null,
    });
  } catch (error) {
    console.error("[purchase/session]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
