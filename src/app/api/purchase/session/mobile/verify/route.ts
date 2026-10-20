import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/purchase-api";
import { issueTicket, verifyMobileChallenge } from "@/lib/purchase-auth";

export const dynamic = "force-dynamic";

type VerifyBody = { challenge?: string; code?: string | number };

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /api/purchase/session/mobile/verify
 * 客户侧自助入口第二步：挑战 + 手机号后 6 位 → 签发客户会话票据（绑定门店与客户名称）。
 *
 * 说明：挑战由 /api/purchase/session/mobile 签发（内含手机号、门店、客户名称，10 分钟有效），
 * 服务端只认签名，不接受前端直接传门店/客户名称。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as VerifyBody;
    const code = String(body.code ?? "").replace(/\D/g, "");

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (!rateLimit(`mobile-verify:${ip}`, 30, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    }

    const challenge = verifyMobileChallenge(body.challenge ?? "");
    if (!challenge) {
      return NextResponse.json({ error: "mobile_expired" }, { status: 403 });
    }

    if (code.length !== 6) {
      return NextResponse.json({ error: "invalid_code" }, { status: 400 });
    }
    if (challenge.mobile.slice(-6) !== code) {
      return NextResponse.json({ error: "code_mismatch" }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      role: "customer",
      storeName: challenge.storeName,
      customerLabel: challenge.customerLabel ?? null,
      displayName: challenge.customerLabel ?? challenge.storeName,
      token: issueTicket({
        role: "customer",
        storeName: challenge.storeName,
        customerLabel: challenge.customerLabel,
        ttlMs: SESSION_TTL_MS,
      }),
    });
  } catch (error) {
    console.error("[purchase/session/mobile/verify]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
