import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { badRequest, permissionDenied } from "@/lib/purchase-api";
import { loadAdminOrder } from "@/lib/purchase-service";
import { emptyState } from "@/lib/purchase-service";
import { getOrderState, saveOrderState } from "@/lib/purchase-store";
import { buildShippingRequest, dispatchShipping } from "@/lib/purchase-shipping";
import type { ApprovalAction, ApprovalLog, OrderApprovalState } from "@/lib/purchase-types";

export const dynamic = "force-dynamic";

type ApproveBody = {
  action?: ApprovalAction;
  remark?: string;
  actor?: string;
  /** 审批中发现的错误可直接改价：商品编号 → 新的客户采购单价 */
  priceOverrides?: Record<string, number>;
};

const NEXT_STAGE: Record<ApprovalAction, OrderApprovalState["stage"]> = {
  finance_pass: "finance_approved",
  finance_reject: "rejected",
  hq_pass: "hq_approved",
  hq_reject: "rejected",
};

/**
 * POST /api/purchase/admin/orders/{applyId}/approve
 * 财务审批（范娅娅）→ 总部审批（郭伟伟）；审批时可编辑改价。
 * 总部通过后触发顺丰出库（接口未配置时置「待出库」并保存待发请求体）。
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
    const body = (await request.json()) as ApproveBody;
    const action = body.action;
    if (!action || !(action in NEXT_STAGE)) return badRequest("invalid_action");

    const order = await loadAdminOrder(applyId);
    if (!order) return permissionDenied();

    const existing = (await getOrderState(applyId)) ?? emptyState(applyId, order.orderNo, order.storeName);
    const stage = existing.stage;

    const allowed =
      action === "finance_pass" || action === "finance_reject"
        ? stage === "submitted"
        : stage === "finance_approved";
    if (!allowed) {
      return NextResponse.json(
        { error: "invalid_state", stage, message: `当前状态（${stage}）不允许该操作` },
        { status: 409 },
      );
    }

    // 审批中改价：只允许改客户采购单价，且必须是本单据存在的商品
    const overrides: Record<string, number> = { ...(existing.priceOverrides ?? {}) };
    const changes: ApprovalLog["changes"] = [];
    const input = body.priceOverrides ?? {};
    for (const [productCode, rawPrice] of Object.entries(input)) {
      const price = Number(rawPrice);
      const line = order.lines.find((item) => item.productCode === productCode);
      if (!line || !Number.isFinite(price) || price <= 0) continue;
      const before = line.customerUnitPrice;
      overrides[productCode] = price;
      changes.push({ field: `客户采购单价 ${productCode}`, from: String(before), to: String(price) });
    }

    const log: ApprovalLog = {
      at: new Date().toISOString(),
      actor: body.actor?.trim() || (action.startsWith("finance") ? "范娅娅" : "郭伟伟"),
      action,
      remark: body.remark?.trim() || undefined,
      changes: changes.length ? changes : undefined,
    };

    const next: OrderApprovalState = {
      ...existing,
      stage: NEXT_STAGE[action],
      priceOverrides: Object.keys(overrides).length ? overrides : undefined,
      logs: [...(existing.logs ?? []), log],
    };

    // 总部通过 → 触发顺丰出库（留桩）
    if (action === "hq_pass") {
      const shippingRequest = buildShippingRequest({
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
      next.shippingRequest = shippingRequest;

      const result = await dispatchShipping(shippingRequest);
      if (result.configured && result.ok) {
        next.stage = "shipping";
        next.shippedAt = new Date().toISOString();
      }
      next.shippingResponse = `${result.message}${result.response ? ` | ${result.response}` : ""}`;
      next.logs = [
        ...next.logs,
        {
          at: new Date().toISOString(),
          actor: "system",
          action: "hq_pass",
          remark: result.message,
        },
      ];
    }

    const saved = await saveOrderState(next);

    return NextResponse.json({
      ok: true,
      stage: saved.stage,
      priceOverrides: saved.priceOverrides ?? {},
      shippingConfigured: Boolean(process.env.PURCHASE_SF_SHIPPING_URL),
      shippingMessage: saved.shippingResponse ?? null,
    });
  } catch (error) {
    console.error("[purchase/admin/approve]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
