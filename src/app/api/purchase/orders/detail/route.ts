import { NextRequest, NextResponse } from "next/server";
import { readTicket, ticketCustomerKey } from "@/lib/purchase-auth";
import { badRequest, permissionDenied } from "@/lib/purchase-api";
import { loadCustomerOrders, loadStates, toCustomerOrder } from "@/lib/purchase-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchase/orders/detail?orderNo=xxx —— 客户侧详情
 * 只能查询本门店单据；查不到或不属于本门店统一返回 404。
 */
export async function GET(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ticket.role !== "customer" || (!ticket.storeName && !ticket.customerLabel)) return permissionDenied();

    const orderNo = new URL(request.url).searchParams.get("orderNo")?.trim();
    if (!orderNo) return badRequest("order_no_required");

    const [orders, states] = await Promise.all([
      loadCustomerOrders(ticketCustomerKey(ticket), ticket.storeName),
      loadStates(),
    ]);
    const hit = orders.find((order) => order.orderNo === orderNo);
    if (!hit) return permissionDenied();

    return NextResponse.json({ order: toCustomerOrder(hit, states.get(hit.applyId)) });
  } catch (error) {
    console.error("[purchase/orders/detail]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
