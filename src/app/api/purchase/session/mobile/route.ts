import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/purchase-api";
import { issueMobileChallenge, issueTicket } from "@/lib/purchase-auth";
import { maskMobile, normalizeMobile, resolveCustomerByIdentity } from "@/lib/purchase-identity";

export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type MobileBody = { mobile?: string | number };

/**
 * POST /api/purchase/session/mobile
 * 客户侧自助入口：手机号 → 匹配「客户端基础信息」客户档案 → 直接签发客户会话。
 *
 * 场景：轻流门户对外部客户注入的 qfExtUserId 为空值（外部用户没有工作区成员身份），
 *      无法免登，改由客户输入本人档案登记的手机号来定位门店。
 *
 * 安全说明：不再要求"手机号后 6 位"——该值就是手机号的子串，与手机号同源，
 * 不构成第二因子（知道手机号即知道后 6 位），因此只保留限流 + 只读 + 字段白名单投影。
 * 若日后需要真正的第二因子，应改用短信验证码。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as MobileBody;
    const mobile = normalizeMobile(String(body.mobile ?? ""));

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (!rateLimit(`mobile-ip:${ip}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    }
    if (mobile) {
      if (!rateLimit(`mobile-no:${mobile}`, 8, 60 * 60 * 1000)) {
        return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      }
    }

    if (!/^1\d{10}$/.test(mobile)) {
      return NextResponse.json({ error: "invalid_mobile" }, { status: 400 });
    }

    const customer = await resolveCustomerByIdentity({ mobile });
    if (!customer || !customer.storeName) {
      return NextResponse.json({ error: "no_customer_profile" }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      verified: true,
      role: "customer",
      mobileMask: maskMobile(mobile),
      storeName: customer.storeName,
      customerLabel: customer.customerLabel ?? null,
      factorConfigured: customer.factor != null && customer.factor > 0,
      token: issueTicket({
        role: "customer",
        storeName: customer.storeName,
        customerLabel: customer.customerLabel ?? undefined,
        ttlMs: SESSION_TTL_MS,
      }),
      // 兼容保留：仍签发一次性挑战，供两步式流程（/session/mobile/verify）使用
      challenge: issueMobileChallenge({
        mobile,
        storeName: customer.storeName,
        customerLabel: customer.customerLabel ?? undefined,
      }),
    });
  } catch (error) {
    console.error("[purchase/session/mobile]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
