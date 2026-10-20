import { NextRequest, NextResponse } from "next/server";
import { readTicket, ticketCustomerKey } from "@/lib/purchase-auth";
import { permissionDenied } from "@/lib/purchase-api";
import { DEFAULT_WAREHOUSE_KEEPER, DEFAULT_WAREHOUSE_NAME } from "@/lib/purchase-fields";
import { getStorePricing, getWarehouseByName, priceItem } from "@/lib/purchase-data";
import { round4, summarize } from "@/lib/purchase-pricing";
import { emptyState, loadCustomerOrders, loadStates, toCustomerSummary } from "@/lib/purchase-service";
import { saveOrderState } from "@/lib/purchase-store";
import { createPurchaseApply, pollOperation, type PurchaseApplyLine } from "@/lib/purchase-write";

export const dynamic = "force-dynamic";

/** GET /api/purchase/orders —— 客户侧：仅本门店单据 */
export async function GET(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ticket.role !== "customer" || (!ticket.storeName && !ticket.customerLabel)) {
      return permissionDenied();
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const rawPageSize = Number(searchParams.get("pageSize") ?? "5") || 5;
    const pageSize = Math.min(50, Math.max(1, rawPageSize));

    const [orders, states] = await Promise.all([
      loadCustomerOrders(ticketCustomerKey(ticket), ticket.storeName),
      loadStates(),
    ]);
    const total = orders.length;
    const start = (page - 1) * pageSize;
    const pageOrders = orders.slice(start, start + pageSize);

    return NextResponse.json({
      storeName: ticket.storeName,
      total,
      page,
      pageSize,
      orders: pageOrders.map((order) => toCustomerSummary(order, states.get(order.applyId))),
    });
  } catch (error) {
    console.error("[purchase/orders:GET]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

type SubmitBody = {
  lines?: { productCode?: string; qty?: number }[];
  warehouseName?: string;
  deliveryDate?: string;
  expectedArrival?: string;
  remark?: string;
};

/**
 * POST /api/purchase/orders —— 客户侧提交申请
 * 服务端重算全部价格（不接受前端金额），随后创建轻流单据并记录二开侧审批状态。
 */
export async function POST(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ticket.role !== "customer" || !ticket.storeName) return permissionDenied();

    const body = (await request.json()) as SubmitBody;
    const inputLines = Array.isArray(body.lines) ? body.lines : [];
    if (inputLines.length === 0) return NextResponse.json({ error: "empty_lines" }, { status: 400 });
    if (inputLines.length > 200) return NextResponse.json({ error: "too_many_lines" }, { status: 400 });

    // 客户侧不填写出库信息：仓库/仓管/出库日期由服务端按默认值填充，
    // 保证轻流单据的必填字段能正常落地（出库环节再修正）。
    const requestedWarehouse = String(body.warehouseName ?? "").trim();
    const warehouseName = requestedWarehouse || process.env.PURCHASE_DEFAULT_WAREHOUSE || DEFAULT_WAREHOUSE_NAME;
    const requestedDate = String(body.deliveryDate ?? "").trim();
    const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : new Date().toISOString().slice(0, 10);

    const warehouse = await getWarehouseByName(warehouseName);
    if (!warehouse) return NextResponse.json({ error: "warehouse_not_found" }, { status: 400 });

    const lines: PurchaseApplyLine[] = [];
    const missing: string[] = [];
    let factor: number | null = null;

    for (const input of inputLines) {
      const productCode = String(input.productCode ?? "").trim();
      const qty = Number(input.qty ?? 0);
      if (!productCode || !Number.isFinite(qty) || qty <= 0) continue;

      const quoted = await priceItem({ storeName: ticket.storeName, productCode, qty });
      if (!quoted) continue;
      if (quoted.customerUnitPrice == null || quoted.factor == null) {
        missing.push(productCode);
        continue;
      }
      factor = quoted.factor;
      lines.push({
        productCode: quoted.item.productCode,
        productName: quoted.item.productName,
        spec: quoted.item.spec,
        baseUnit: quoted.item.baseUnit,
        baseUnitCode: quoted.item.baseUnitCode,
        qty: round4(qty),
        purchasePrice: quoted.item.purchasePrice,
        factor: quoted.factor,
        markupFactor: quoted.markupFactor,
        customerUnitPrice: quoted.customerUnitPrice,
        customerAmount: quoted.customerAmount ?? 0,
      });
    }

    if (lines.length === 0) {
      return NextResponse.json({ error: "no_priced_lines", missingFactorFor: missing }, { status: 400 });
    }
    if (missing.length > 0) {
      return NextResponse.json({ error: "missing_factor", missingFactorFor: missing }, { status: 400 });
    }

    const totals = summarize(
      lines.map((line) => ({ qty: line.qty, customerAmount: line.customerAmount })),
    );

    const storePricing = await getStorePricing(ticket.storeName);
    const { requestId } = await createPurchaseApply({
      // 「客户名称」取客户端基础信息·客户名称（462540980）；「门店名称」取同一记录的 462540991
      customerName: storePricing.customerName ?? ticket.storeName,
      storeName: ticket.storeName,
      customerLabel: storePricing.customerLabel ?? undefined,
      warehouseName: warehouse.name,
      warehouseCode: warehouse.code,
      warehouseKeeper: process.env.PURCHASE_DEFAULT_KEEPER ?? DEFAULT_WAREHOUSE_KEEPER,
      deliveryDate,
      factor: factor ?? 0,
      totalQty: totals.totalQty,
      totalCustomerAmount: totals.totalAmount,
      lines,
    });

    const polled = await pollOperation(requestId);
    if (!polled.ok || !polled.applyId) {
      return NextResponse.json(
        { error: "create_failed", detail: polled.message, requestId },
        { status: 502 },
      );
    }

    const applyId = polled.applyId;
    const orderNo = await resolveOrderNo(applyId, ticketCustomerKey(ticket), ticket.storeName);
    const state = emptyState(applyId, orderNo, ticket.storeName);
    state.lines = lines.map((line) => ({
      productCode: line.productCode,
      productName: line.productName,
      spec: line.spec,
      baseUnit: line.baseUnit,
      baseUnitCode: line.baseUnitCode,
      qty: line.qty,
      purchasePrice: line.purchasePrice,
      priceFactor: line.factor,
      markupFactor: line.markupFactor,
      taxRate: null,
      priceNoTax: null,
      priceWithTax: null,
      amountNoTax: null,
      shipAmount: null,
      customerUnitPrice: line.customerUnitPrice,
      customerAmount: line.customerAmount,
    }));
    await saveOrderState(state);

    return NextResponse.json({
      ok: true,
      applyId,
      orderNo,
      totalQty: totals.totalQty,
      totalAmount: totals.totalAmount,
    });
  } catch (error) {
    console.error("[purchase/orders:POST]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/** 轻流编号由系统生成，创建后回读一次拿编号 */
async function resolveOrderNo(applyId: string, key: string, altKey?: string): Promise<string> {
  try {
    const orders = await loadCustomerOrders(key, altKey);
    const hit = orders.find((order) => order.applyId === applyId);
    return hit?.orderNo ?? applyId;
  } catch {
    return applyId;
  }
}
