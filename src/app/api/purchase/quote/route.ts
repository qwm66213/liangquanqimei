import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";
import { priceItem } from "@/lib/purchase-data";
import { round4, summarize } from "@/lib/purchase-pricing";

export const dynamic = "force-dynamic";

type QuoteRequestBody = {
  lines?: { productCode?: string; qty?: number }[];
};

/**
 * POST /api/purchase/quote
 * 服务端算价：客户采购单价 = 进货单价 × 系数（加价系数优先，0 视同空），4 位小数。
 * 只返回客户可见字段（不含进货单价、系数等成本信息）。
 */
export async function POST(request: NextRequest) {
  try {
    const ticket = readTicket(request);
    if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await request.json()) as QuoteRequestBody;
    const inputLines = Array.isArray(body.lines) ? body.lines : [];
    if (inputLines.length === 0) {
      return NextResponse.json({ error: "empty_lines" }, { status: 400 });
    }
    if (inputLines.length > 200) {
      return NextResponse.json({ error: "too_many_lines" }, { status: 400 });
    }

    const storeName = new URL(request.url).searchParams.get("store")?.trim() ?? ticket.storeName ?? "";

    const lines = [];
    const missing: string[] = [];

    for (const line of inputLines) {
      const productCode = String(line.productCode ?? "").trim();
      const qty = Number(line.qty ?? 0);
      if (!productCode || !Number.isFinite(qty) || qty <= 0) continue;

      const quoted = await priceItem({ storeName, productCode, qty });
      if (!quoted) continue;

      if (quoted.customerUnitPrice == null) {
        missing.push(productCode);
        continue;
      }

      lines.push({
        productCode: quoted.item.productCode,
        productName: quoted.item.productName,
        spec: quoted.item.spec,
        baseUnit: quoted.item.baseUnit,
        qty: round4(qty),
        customerUnitPrice: quoted.customerUnitPrice,
        customerAmount: quoted.customerAmount ?? 0,
      });
    }

    const totals = summarize(
      lines.map((line) => ({ qty: line.qty, customerAmount: line.customerAmount })),
    );

    return NextResponse.json({
      storeName,
      lines,
      totalQty: totals.totalQty,
      totalAmount: totals.totalAmount,
      missingFactorFor: missing,
    });
  } catch (error) {
    console.error("[purchase/quote]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
