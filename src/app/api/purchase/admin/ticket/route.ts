import { NextRequest, NextResponse } from "next/server";
import { issueTicket, readTicket } from "@/lib/purchase-auth";
import { badRequest, permissionDenied } from "@/lib/purchase-api";
import { resolveCustomerByIdentity } from "@/lib/purchase-identity";
import type { PortalRole } from "@/lib/purchase-types";

export const dynamic = "force-dynamic";

type TicketBody = {
  role?: PortalRole;
  /** 客户名称（推荐）：服务端反查门店名称与归属键 */
  customerLabel?: string;
  /** 兼容旧参数：直接给门店名称（此时归属键同门店名称） */
  storeName?: string;
  ttlDays?: number;
};

/**
 * POST /api/purchase/admin/ticket
 * 管理侧生成入口链接（内嵌到轻流门户用）：
 *   管理侧：role=admin
 *   客户侧：role=customer + customerLabel（客户名称）→ 自动带出门店名称与行级归属键
 */
export async function POST(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket || ticket.role !== "admin") return permissionDenied();

    const body = (await request.json()) as TicketBody;
    const role = body.role ?? "customer";
    const ttlDays = Number.isFinite(Number(body.ttlDays)) && Number(body.ttlDays) > 0 ? Number(body.ttlDays) : 30;
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const origin = new URL(request.url).origin;

    if (role === "admin") {
      const token = issueTicket({ role, ttlMs });
      return NextResponse.json({
        role,
        storeName: null,
        token,
        url: `${origin}/purchase.html?t=${encodeURIComponent(token)}`,
        expiresInDays: ttlDays,
      });
    }

    const label = (body.customerLabel ?? body.storeName ?? "").trim();
    if (!label) return badRequest("customer_required");

    const customer = await resolveCustomerByIdentity({ name: label });
    const storeName = customer?.storeName || label;
    const customerLabel = customer?.customerLabel ?? label;
    const token = issueTicket({ role, storeName, customerLabel, ttlMs });

    return NextResponse.json({
      role,
      storeName,
      customerLabel,
      factor: customer?.factor ?? null,
      token,
      url: `${origin}/purchase.html?t=${encodeURIComponent(token)}`,
      expiresInDays: ttlDays,
    });
  } catch (error) {
    console.error("[purchase/admin/ticket]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
