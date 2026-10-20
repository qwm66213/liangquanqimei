import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { permissionDenied } from "@/lib/purchase-api";
import { loadAdminOrder } from "@/lib/purchase-service";
import { getOrderState, updateOrderState } from "@/lib/purchase-store";
import { buildShippingRequest, dispatchShipping } from "@/lib/purchase-shipping";

export const dynamic = "force-dynamic";

/**
 * POST /api/purchase/admin/orders/{applyId}/dispatch
 * 仅总部审批通过（hq_approved）的单据可发起/重试顺丰出库请求。
 * 顺丰接口地址未配置时不发起调用，仅保留待发请求体。
 */
export async function POST(
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
    if (!state || (state.stage !== "hq_approved" && state.stage !== "shipping")) {
      return NextResponse.json(
        { error: "invalid_state", stage: state?.stage ?? "unknown" },
        { status: 409 },
      );
    }

    const payload =
      state.shippingRequest ??
      buildShippingRequest({
        orderNo: order.orderNo,
        storeName: order.storeName,
        warehouseName: order.warehouseName,
        warehouseCode: order.warehouseCode,
        deliveryDate: order.deliveryDate,
        expectedArrival: order.expectedArrival,
        lines: order.lines.map((line) => ({
          productCode: line.productCode,
          productName: line.productName,
          spec: line.spec,
          unit: line.baseUnit,
          qty: line.qty,
        })),
      });

    const result = await dispatchShipping(payload);

    await updateOrderState(applyId, (current) => ({
      ...current,
      shippingRequest: payload,
      shippingResponse: `${result.message}${result.response ? ` | ${result.response}` : ""}`,
      stage: result.configured && result.ok ? "shipping" : current.stage,
      shippedAt: result.configured && result.ok ? new Date().toISOString() : current.shippedAt,
      logs: [
        ...(current.logs ?? []),
        {
          at: new Date().toISOString(),
          actor: "system",
          action: "hq_pass",
          remark: result.message,
        },
      ],
    }));

    return NextResponse.json({
      ok: result.ok,
      configured: result.configured,
      message: result.message,
    });
  } catch (error) {
    console.error("[purchase/admin/dispatch]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
