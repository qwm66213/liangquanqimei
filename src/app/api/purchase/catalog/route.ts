import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { getCatalog, getStorePricing, getWarehouseOptions } from "@/lib/purchase-data";
import {
  DEFAULT_WAREHOUSE_CODE,
  DEFAULT_WAREHOUSE_KEEPER,
  DEFAULT_WAREHOUSE_NAME,
} from "@/lib/purchase-fields";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchase/catalog
 * 返回商品选择列表（状态=开启 且 配货类型=CP）、出库仓库下拉、出库默认值。
 * 注意：商品行不下发进货单价等成本字段。
 */
export async function GET(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const queryStore = new URL(request.url).searchParams.get("store")?.trim();
    const storeName = ticket.role === "customer" ? ticket.storeName ?? "" : queryStore ?? "";

    const [items, warehouses, pricing] = await Promise.all([
      getCatalog(),
      getWarehouseOptions(),
      storeName ? getStorePricing(storeName) : Promise.resolve(null),
    ]);

    const defaultWarehouse =
      warehouses.find((item) => item.name === DEFAULT_WAREHOUSE_NAME) ??
      warehouses.find((item) => item.code === DEFAULT_WAREHOUSE_CODE) ??
      null;

    return NextResponse.json({
      role: ticket.role,
      storeName,
      customerLabel: pricing?.customerLabel ?? null,
      customerName: pricing?.customerName ?? null,
      factorConfigured: pricing ? pricing.factor != null : false,
      items: items.map((item) => ({
        productCode: item.productCode,
        productName: item.productName,
        spec: item.spec,
        baseUnit: item.baseUnit,
      })),
      warehouses,
      defaults: {
        warehouseName: defaultWarehouse?.name ?? DEFAULT_WAREHOUSE_NAME,
        warehouseCode: defaultWarehouse?.code ?? DEFAULT_WAREHOUSE_CODE,
        warehouseKeeper: DEFAULT_WAREHOUSE_KEEPER,
      },
    });
  } catch (error) {
    console.error("[purchase/catalog]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
