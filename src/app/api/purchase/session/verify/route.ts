import { NextRequest, NextResponse } from "next/server";
import { issueTicket } from "@/lib/purchase-auth";
import { rateLimit } from "@/lib/purchase-api";
import { bindingTtlMs, saveBinding } from "@/lib/purchase-bindings";
import {
  fetchQingflowUser,
  isInternalAllowed,
  maskMobile,
  normalizeMobile,
  resolveCustomerByIdentity,
} from "@/lib/purchase-identity";

export const dynamic = "force-dynamic";

type VerifyBody = {
  extUserId?: string | number;
  code?: string | number;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /api/purchase/session/verify
 * 首次绑定校验：输入本人手机号后 6 位，与轻流账号手机号比对（内部账号与客户账号同一套校验）。
 * 通过后写入 userId ↔ 身份 绑定（默认 90 天），此后免验证。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyBody;
    const extUserId = String(body.extUserId ?? "").trim();
    const code = String(body.code ?? "").replace(/\D/g, "");

    if (!/^\d+$/.test(extUserId)) {
      return NextResponse.json({ error: "identity_missing" }, { status: 400 });
    }
    if (code.length !== 6) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }
    if (!rateLimit(`verify:${extUserId}`, 10, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
    }

    const user = await fetchQingflowUser(extUserId);
    if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

    const mobile = normalizeMobile(user.mobileNum);
    if (mobile.length < 6 || mobile.slice(-6) !== code) {
      return NextResponse.json({ error: "code_mismatch" }, { status: 401 });
    }

    const now = Date.now();
    const expiresAt = new Date(now + bindingTtlMs()).toISOString();
    const boundAt = new Date(now).toISOString();
    const mobileMask = maskMobile(user.mobileNum);

    // 内部白名单账号：可见全量
    if (isInternalAllowed(user)) {
      await saveBinding({
        qfUserId: user.userId,
        role: "admin",
        displayName: user.name,
        mobileMask,
        boundAt,
        expiresAt,
      });
      return NextResponse.json({
        ok: true,
        verified: true,
        role: "admin",
        token: issueTicket({ role: "admin", ttlMs: SESSION_TTL_MS }),
        storeName: null,
        displayName: user.name,
      });
    }

    // 客户账号：仅本门店
    const customer = await resolveCustomerByIdentity({ mobile: user.mobileNum, name: user.name });
    if (!customer || !customer.storeName) {
      return NextResponse.json({ error: "no_customer_profile", name: user.name }, { status: 403 });
    }

    await saveBinding({
      qfUserId: user.userId,
      role: "customer",
      storeName: customer.storeName,
      customerLabel: customer.customerLabel ?? null,
      displayName: user.name,
      mobileMask,
      boundAt,
      expiresAt,
    });

    return NextResponse.json({
      ok: true,
      verified: true,
      role: "customer",
      token: issueTicket({
        role: "customer",
        storeName: customer.storeName,
        customerLabel: customer.customerLabel ?? undefined,
        ttlMs: SESSION_TTL_MS,
      }),
      storeName: customer.storeName,
      customerLabel: customer.customerLabel ?? null,
      displayName: user.name,
      matchedBy: customer.matchedBy ?? null,
    });
  } catch (error) {
    console.error("[purchase/session/verify]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
