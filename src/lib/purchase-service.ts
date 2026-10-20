/**
 * 单据服务层：读取轻流单据 + 合并二开侧审批状态 + 按角色投影。
 *
 * 价格口径以二开侧计算为准（保证客户侧与管理侧一致）；
 * 管理侧改价写为覆盖价（存在二开侧），客户侧展示同样读取覆盖价。
 */

import { PURCHASE_APP_KEY, PURCHASE_ITEM_QUE, PURCHASE_QUE } from "./purchase-fields";
import {
  filterAllRows,
  pickCellNumber,
  pickCellValue,
  pickNumber,
  pickTableRows,
  pickValue,
  type QfRow,
} from "./purchase-qingflow";
import { priceItem } from "./purchase-data";
import { round4, summarize } from "./purchase-pricing";
import { listOrderStates } from "./purchase-store";
import type {
  AdminOrder,
  AdminOrderLine,
  AdminOrderSummary,
  ApprovalStage,
  CustomerOrder,
  CustomerOrderSummary,
  OrderApprovalState,
} from "./purchase-types";

const STAGE_TEXT: Record<ApprovalStage, string> = {
  submitted: "待财务审批",
  finance_approved: "待总部审批",
  hq_approved: "待出库",
  shipping: "出库中",
  shipped: "已出库",
  rejected: "已驳回",
  history: "历史单据",
};

/** 客户口径状态文案（不暴露内部节点名） */
const CUSTOMER_STAGE_TEXT: Record<ApprovalStage, string> = {
  submitted: "申请中",
  finance_approved: "审核中",
  hq_approved: "待发货",
  shipping: "发货中",
  shipped: "已发货",
  rejected: "已驳回",
  history: "已完成",
};

/**
 * 客户侧状态：一律跟随轻流「当前流程状态」。
 * 管理侧审批在轻流完成，二开侧不维护审批状态，避免两边不一致。
 */
function customerStatus(order: AdminOrder): string {
  const fromFlow = order.status.trim();
  return fromFlow || "申请中";
}

export function stageText(stage: ApprovalStage): string {
  return STAGE_TEXT[stage] ?? "申请中";
}

export function customerStageText(stage: ApprovalStage): string {
  return CUSTOMER_STAGE_TEXT[stage] ?? "申请中";
}

export async function loadStates(): Promise<Map<string, OrderApprovalState>> {
  const states = await listOrderStates();
  return new Map(states.map((state) => [state.applyId, state]));
}

export function emptyState(applyId: string, orderNo: string, storeName: string): OrderApprovalState {
  const now = new Date().toISOString();
  return {
    applyId,
    orderNo,
    storeName,
    stage: "submitted",
    createdAt: now,
    updatedAt: now,
    logs: [],
  };
}

/** 单张单据 → 管理侧结构（含成本字段） */
async function mapRowToAdminOrder(
  row: QfRow,
  state: OrderApprovalState | undefined,
): Promise<AdminOrder> {
  const applyId = String(row.applyId);
  const orderNo = pickValue(row, PURCHASE_QUE.applyNum) ?? "";
  const storeName = pickValue(row, PURCHASE_QUE.storeName) ?? state?.storeName ?? "";
  const overrides = state?.priceOverrides ?? {};

  const tableRows = pickTableRows(row, PURCHASE_QUE.items);
  const lines: AdminOrderLine[] = [];

  for (const cells of tableRows) {
    const productCode = pickCellValue(cells, PURCHASE_ITEM_QUE.productCode) ?? "";
    if (!productCode) continue;
    const productName = pickCellValue(cells, PURCHASE_ITEM_QUE.productName) ?? "";
    const spec = pickCellValue(cells, PURCHASE_ITEM_QUE.spec) ?? "";
    const baseUnit =
      pickCellValue(cells, PURCHASE_ITEM_QUE.baseUnit) ?? pickCellValue(cells, PURCHASE_ITEM_QUE.outUnit) ?? "";
    const qty = pickCellNumber(cells, PURCHASE_ITEM_QUE.qty) ?? 0;

    const quoted = await priceItem({ storeName, productCode, qty });
    const purchasePrice =
      quoted?.item.purchasePrice ?? pickCellNumber(cells, PURCHASE_ITEM_QUE.purchasePrice) ?? 0;
    const factor = quoted?.factor ?? pickCellNumber(cells, PURCHASE_ITEM_QUE.priceFactor);
    const overridePrice = overrides[productCode];

    // 客户价以轻流单据为准：财务在轻流改价后，客户侧必须看到改后的值。
    // 轻流字段有值（>0）时优先使用；为 0/空（例如历史单据）时再回落到服务端计算值。
    const flowUnitPrice = pickCellNumber(cells, PURCHASE_ITEM_QUE.customerUnitPrice);
    const flowAmount = pickCellNumber(cells, PURCHASE_ITEM_QUE.customerAmount);

    const customerUnitPrice =
      flowUnitPrice != null && flowUnitPrice > 0
        ? round4(flowUnitPrice)
        : overridePrice != null
          ? round4(overridePrice)
          : quoted?.customerUnitPrice ?? 0;
    const customerAmount =
      flowAmount != null && flowAmount > 0 ? round4(flowAmount) : round4(customerUnitPrice * qty);

    lines.push({
      productCode,
      productName,
      spec,
      baseUnit,
      baseUnitCode: pickCellValue(cells, PURCHASE_ITEM_QUE.unitCode) ?? "",
      qty,
      purchasePrice: round4(purchasePrice),
      priceFactor: factor,
      markupFactor: quoted?.markupFactor ?? null,
      taxRate: pickCellNumber(cells, PURCHASE_ITEM_QUE.taxRate),
      priceNoTax: pickCellNumber(cells, PURCHASE_ITEM_QUE.priceNoTax),
      priceWithTax: pickCellNumber(cells, PURCHASE_ITEM_QUE.priceWithTax),
      amountNoTax: pickCellNumber(cells, PURCHASE_ITEM_QUE.amountNoTax),
      shipAmount: pickCellNumber(cells, PURCHASE_ITEM_QUE.shipAmount),
      customerUnitPrice,
      customerAmount,
    });
  }

  const totals = summarize(
    lines.map((line) => ({ qty: line.qty, customerAmount: line.customerAmount })),
  );
  // 单据合计同样以轻流字段为准（>0 时），否则用行合计
  const flowTotalAmount = pickNumber(row, PURCHASE_QUE.totalCustomer);
  const totalCustomerAmount =
    flowTotalAmount != null && flowTotalAmount > 0 ? round4(flowTotalAmount) : totals.totalAmount;

  return {
    applyId,
    orderNo,
    status: pickValue(row, PURCHASE_QUE.status) ?? "",
    applyTime: pickValue(row, PURCHASE_QUE.applyTime) ?? "",
    updateTime: pickValue(row, PURCHASE_QUE.updateTime) ?? "",
    storeName,
    customerLabel: pickValue(row, PURCHASE_QUE.customerText) ?? "",
    customerName: pickValue(row, PURCHASE_QUE.customerName) ?? "",
    storeCode: pickValue(row, PURCHASE_QUE.storeCode) ?? "",
    warehouseName: pickValue(row, PURCHASE_QUE.warehouse) ?? "",
    warehouseCode: pickValue(row, PURCHASE_QUE.warehouseCode) ?? "",
    warehouseKeeper: pickValue(row, PURCHASE_QUE.warehouseKeeper) ?? "",
    deliveryDate: pickValue(row, PURCHASE_QUE.deliveryDate) ?? "",
    expectedArrival: pickValue(row, PURCHASE_QUE.expectDate) ?? "",
    remark: pickValue(row, PURCHASE_QUE.remark) ?? "",
    totalQty: totals.totalQty,
    totalInternalAmount: pickNumber(row, PURCHASE_QUE.totalInternal) ?? 0,
    totalCustomerAmount,
    lines,
  };
}

/** 管理侧：全部单据 */
export async function loadAdminOrders(): Promise<AdminOrder[]> {
  const [rows, states] = await Promise.all([
    filterAllRows(PURCHASE_APP_KEY, { pageSize: 200 }),
    loadStates(),
  ]);
  const orders: AdminOrder[] = [];
  for (const row of rows) {
    orders.push(await mapRowToAdminOrder(row, states.get(String(row.applyId))));
  }
  orders.sort((a, b) => (a.applyTime < b.applyTime ? 1 : a.applyTime > b.applyTime ? -1 : 0));
  return orders;
}

export async function loadAdminOrder(applyId: string): Promise<AdminOrder | null> {
  const [rows, states] = await Promise.all([
    filterAllRows(PURCHASE_APP_KEY, { pageSize: 200 }),
    loadStates(),
  ]);
  const row = rows.find((item) => String(item.applyId) === applyId);
  if (!row) return null;
  return mapRowToAdminOrder(row, states.get(applyId));
}

/**
 * 客户侧：仅本客户单据（排序：申请时间新→旧，同一时间按单据号排）
 *
 * 归属键说明（重要）：单据里的「门店名称」与客户端基础信息里的门店名称不是同一套值
 *   （单据：粮全其美国展店 / 客户端基础信息：粮全其美国展中心店），
 * 因此归属过滤以「客户名称」为主键（单据「客户」单选 = 客户端基础信息·客户名称），
 * 门店名称仅作兜底匹配。
 */
export async function loadCustomerOrders(key: string, altKey?: string): Promise<AdminOrder[]> {
  const orders = await loadAdminOrders();
  const targets = [key, altKey]
    .map((item) => (item ?? "").trim())
    .filter((item) => item !== "");
  if (targets.length === 0) return [];
  const filtered = orders.filter((order) => {
    const labels = [order.customerLabel.trim(), order.storeName.trim(), order.customerName.trim()];
    return targets.some((target) => labels.includes(target));
  });
  filtered.sort((a, b) => {
    if (a.applyTime !== b.applyTime) return a.applyTime < b.applyTime ? 1 : -1;
    if (a.orderNo !== b.orderNo) return a.orderNo < b.orderNo ? 1 : -1;
    return 0;
  });
  return filtered;
}

export function toAdminSummary(
  order: AdminOrder,
  state: OrderApprovalState | undefined,
): AdminOrderSummary {
  const stage: ApprovalStage = state?.stage ?? "history";
  return {
    applyId: order.applyId,
    orderNo: order.orderNo,
    status: order.status,
    storeName: order.storeName,
    customerName: order.customerName,
    applyTime: order.applyTime,
    deliveryDate: order.deliveryDate,
    totalQty: order.totalQty,
    totalCustomerAmount: order.totalCustomerAmount,
    approvalStage: stage,
    approvalStageText: stageText(stage),
  };
}

/** 客户侧投影：只输出白名单字段（类型上即无成本字段） */
export function toCustomerOrder(
  order: AdminOrder,
  state: OrderApprovalState | undefined,
): CustomerOrder {
  return {
    orderNo: order.orderNo,
    status: customerStatus(order),
    applyTime: order.applyTime,
    deliveryDate: order.deliveryDate,
    expectedArrival: order.expectedArrival,
    warehouseName: order.warehouseName,
    storeName: order.storeName,
    remark: order.remark,
    lines: order.lines.map((line) => ({
      productCode: line.productCode,
      productName: line.productName,
      spec: line.spec,
      baseUnit: line.baseUnit,
      qty: line.qty,
      customerUnitPrice: line.customerUnitPrice,
      customerAmount: line.customerAmount,
    })),
    totalQty: order.totalQty,
    totalAmount: order.totalCustomerAmount,
  };
}

export function toCustomerSummary(
  order: AdminOrder,
  state: OrderApprovalState | undefined,
): CustomerOrderSummary {
  return {
    orderNo: order.orderNo,
    status: customerStatus(order),
    applyTime: order.applyTime,
    totalQty: order.totalQty,
    totalAmount: order.totalCustomerAmount,
    storeName: order.storeName,
  };
}
