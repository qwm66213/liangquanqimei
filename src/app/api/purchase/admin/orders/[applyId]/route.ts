import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { permissionDenied } from "@/lib/purchase-api";
import { loadAdminOrder, stageText } from "@/lib/purchase-service";
import { getOrderState } from "@/lib/purchase-store";

export const dynamic = "force-dynamic";

/** GET /api/purchase/admin/orders/{applyId} —— 管理侧详情（全字段 + 审批日志 + 待发顺丰请求） */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ applyId: string }> },
) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ticket.role !== "admin") return permissionDenied();

    const { applyId } = await context.params;
    const order = await loadAdminOrder(applyId);
    if (!order) return permissionDenied();

    const state = await getOrderState(applyId);
    const stage = state?.stage ?? "submitted";

    return NextResponse.json({
      order,
      approval: {
        stage,
        stageText: stageText(stage),
        logs: state?.logs ?? [],
        priceOverrides: state?.priceOverrides ?? {},
        shippingRequest: state?.shippingRequest ?? null,
        shippingResponse: state?.shippingResponse ?? null,
        shippedAt: state?.shippedAt ?? null,
      },
    });
  } catch (error) {
    console.error("[purchase/admin/orders/:applyId]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
