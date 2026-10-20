import { NextRequest, NextResponse } from "next/server";
import { fetchLedgerRows } from "@/lib/qingflow";
import { recomputeOpeningClosing } from "@/lib/ledger-rebalance";
import type { LedgerDetailResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function compareLedger(
  a: { date: string; applyTime: string; applyNum: string; applyId: string },
  b: { date: string; applyTime: string; applyNum: string; applyId: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.applyTime !== b.applyTime) return a.applyTime < b.applyTime ? -1 : 1;
  if (a.applyNum !== b.applyNum) return a.applyNum < b.applyNum ? -1 : 1;
  return a.applyId < b.applyId ? -1 : a.applyId > b.applyId ? 1 : 0;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const productCode = searchParams.get("productCode")?.trim();
    const warehouse = searchParams.get("warehouse")?.trim();

    if (!isDate(startDate) || !isDate(endDate)) {
      return NextResponse.json(
        { error: "startDate and endDate are required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    if (startDate > endDate) {
      return NextResponse.json(
        { error: "startDate must be on or before endDate" },
        { status: 400 },
      );
    }
    if (!productCode || !warehouse) {
      return NextResponse.json(
        { error: "productCode and warehouse are required" },
        { status: 400 },
      );
    }

    const ledger = await fetchLedgerRows({
      startDate,
      endDate,
      productCode,
      warehouse,
    });

    const rows = recomputeOpeningClosing(
      ledger.filter(
        (row) =>
          row.productCode === productCode &&
          row.warehouse === warehouse &&
          row.date >= startDate &&
          row.date <= endDate,
      ),
    ).sort(compareLedger);

    const body: LedgerDetailResponse = {
      rows,
      meta: {
        startDate,
        endDate,
        productCode,
        warehouse: warehouse || rows[0]?.warehouse || "",
        productName: rows.find((row) => row.productName)?.productName ?? "",
        count: rows.length,
      },
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error("[ledger]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
