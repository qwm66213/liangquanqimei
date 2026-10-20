import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { permissionDenied } from "@/lib/purchase-api";
import { loadAdminOrders, loadStates, toAdminSummary } from "@/lib/purchase-service";
import type { AdminOrderSummary } from "@/lib/purchase-types";

export const dynamic = "force-dynamic";

/** GET /api/purchase/admin/orders —— 管理侧：全部单据（内部人人可见全量） */
export async function GET(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ticket.role !== "admin") return permissionDenied();

    const { searchParams } = new URL(request.url);
    const stage = searchParams.get("stage")?.trim() ?? "";
    const store = searchParams.get("store")?.trim() ?? "";
    const keyword = searchParams.get("q")?.trim().toLowerCase() ?? "";

    const [orders, states] = await Promise.all([loadAdminOrders(), loadStates()]);
    let summaries: AdminOrderSummary[] = orders.map((order) => toAdminSummary(order, states.get(order.applyId)));

    if (stage) summaries = summaries.filter((item) => item.approvalStage === stage);
    if (store) summaries = summaries.filter((item) => item.storeName === store);
    if (keyword) {
      summaries = summaries.filter(
        (item) =>
          item.orderNo.toLowerCase().includes(keyword) ||
          item.storeName.toLowerCase().includes(keyword) ||
          item.customerName.toLowerCase().includes(keyword),
      );
    }

    const stores = Array.from(new Set(summaries.map((item) => item.storeName).filter(Boolean))).sort();

    return NextResponse.json({
      orders: summaries,
      stores,
      pendingFinance: summaries.filter((item) => item.approvalStage === "submitted").length,
      pendingHq: summaries.filter((item) => item.approvalStage === "finance_approved").length,
      pendingShip: summaries.filter((item) => item.approvalStage === "hq_approved").length,
    });
  } catch (error) {
    console.error("[purchase/admin/orders]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
