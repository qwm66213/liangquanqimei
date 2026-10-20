import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { permissionDenied } from "@/lib/purchase-api";
import { loadAdminOrders, loadStates, stageText } from "@/lib/purchase-service";

export const dynamic = "force-dynamic";

const HEADERS = [
  "单据号",
  "审批状态",
  "轻流状态",
  "门店",
  "客户",
  "申请时间",
  "出库日期",
  "预计收货日期",
  "出库仓库",
  "出库仓管",
  "商品编号",
  "商品名称",
  "规格型号",
  "基本单位",
  "采购数量",
  "进货单价(元)",
  "价格系数",
  "商品加价系数",
  "客户采购单价",
  "客户采购金额",
];

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** GET /api/purchase/admin/export —— 管理侧导出（全字段，含成本列） */
export async function GET(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (ticket.role !== "admin") return permissionDenied();

    const { searchParams } = new URL(request.url);
    const store = searchParams.get("store")?.trim() ?? "";
    const stage = searchParams.get("stage")?.trim() ?? "";

    const [orders, states] = await Promise.all([loadAdminOrders(), loadStates()]);
    const rows: string[] = [HEADERS.join(",")];

    for (const order of orders) {
      const state = states.get(order.applyId);
      const stageValue = state?.stage ?? "submitted";
      if (store && order.storeName !== store) continue;
      if (stage && stageValue !== stage) continue;

      for (const line of order.lines) {
        rows.push(
          [
            order.orderNo,
            stageText(stageValue),
            order.status,
            order.storeName,
            order.customerName,
            order.applyTime,
            order.deliveryDate,
            order.expectedArrival,
            order.warehouseName,
            order.warehouseKeeper,
            line.productCode,
            line.productName,
            line.spec,
            line.baseUnit,
            line.qty,
            line.purchasePrice,
            line.priceFactor ?? "",
            line.markupFactor ?? "",
            line.customerUnitPrice,
            line.customerAmount,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }

    const csv = `\uFEFF${rows.join("\r\n")}`;
    const filename = `客户采购申请_${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[purchase/admin/export]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
