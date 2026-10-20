import { NextRequest, NextResponse } from "next/server";
import { aggregateSummary, collectWarehouses, applyCheckAdjustments } from "@/lib/aggregate";
import { fetchLedgerRows, fetchCheckLedgerRows } from "@/lib/qingflow";
import type { SummaryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}


export async function GET(request: NextRequest) {
  const t0 = Date.now();
  try {
    const { searchParams } = request.nextUrl;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const warehouse = searchParams.get("warehouse")?.trim() || undefined;
    const productCode = searchParams.get("productCode")?.trim() || undefined;
    const productName = searchParams.get("productName")?.trim() || undefined;

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

    // Fetch normal (非盘点) records: warehouse + productCode + date + empty remarks
    // 正常流水数据：备注为空，排除盘点记录
    const tFetch = Date.now();
    const ledger = await fetchLedgerRows({
      endDate,
      productCode,
      productName,
      warehouse,
    });
    // 过滤掉盘点记录（备注非空），盘点数据由单独的检查逻辑处理
    const normalLedger = ledger.filter((row) => !row.remarks || row.remarks === "");
    console.log(`[summary] fetchLedgerRows: ${ledger.length} raw -> ${normalLedger.length} normal (${Date.now() - tFetch}ms)`);

    // Fetch 盘点 rows: always check end-month + previous month
    // (盘点 records may be entered next month, so no date filter here)
    const endMonth = parseInt(endDate.slice(5, 7), 10);
    const prevMonth = endMonth === 1 ? 12 : endMonth - 1;
    const startMonth = parseInt(startDate.slice(5, 7), 10);

    const tCheck = Date.now();
    const allCheckRows = await fetchCheckLedgerRows(endMonth, warehouse);
    if (prevMonth !== endMonth) {
      const prevRows = await fetchCheckLedgerRows(prevMonth, warehouse);
      const seen = new Set(allCheckRows.map((r) => r.applyId));
      for (const r of prevRows) {
        if (!seen.has(r.applyId)) allCheckRows.push(r);
      }
    }
    console.log(`[summary] fetchCheckLedgerRows (${endMonth}月+${prevMonth}月): ${allCheckRows.length} rows (${Date.now() - tCheck}ms)`);

    const warehouses = collectWarehouses(normalLedger);
    const filtered = normalLedger;
    let rows = aggregateSummary(filtered, startDate, endDate);

    const warehouseFilteredCheck = warehouse
      ? allCheckRows.filter((row) => row.warehouse === warehouse)
      : allCheckRows;

    // 盘点数据仅在查询到月末时才注入
    const endDay = parseInt(endDate.slice(8, 10), 10);
    const lastDayOfMonth = new Date(parseInt(endDate.slice(0, 4)), endMonth, 0).getDate();
    const isMonthEnd = endDay === lastDayOfMonth;

    // Previous-month checks: always shift opening/closing (corrects opening balance)
    // check drill-down details only attached at month-end
    const prevMonthCheck = warehouseFilteredCheck.filter((cr) => {
      const m = cr.remarks?.match(/(\d+)月盘点/);
      const cm = m ? parseInt(m[1], 10) : 0;
      return cm > 0 && cm < startMonth;
    });
    if (prevMonthCheck.length > 0) {
      const rowMap = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        rowMap.set(`${row.productCode}||${row.warehouse}`, row);
      }
      for (const cr of prevMonthCheck) {
        const key = `${cr.productCode}||${cr.warehouse}`;
        const target = rowMap.get(key);
        if (!target) continue;
        const qty = cr.nature === "盘盈" ? cr.inbound : cr.outbound;
        if (cr.nature === "盘盈") {
          target.opening += cr.inbound;
        } else if (cr.nature === "盘亏") {
          target.opening -= cr.outbound;
        }
        target.closing = target.opening + target.inbound - target.outbound;

        // Only attach drill-down data at month-end
        if (isMonthEnd) {
          if (!target.checks) target.checks = [];
          target.checks.push({
            nature: cr.nature,
            quantity: qty,
            period: cr.remarks || "",
            date: cr.date,
          });
        }
      }
    }

    // Same-month checks: adjustments + drill-down display, only at month-end
    if (isMonthEnd) {
      const sameMonthCheck = warehouseFilteredCheck.filter((cr) => {
        const m = cr.remarks?.match(/(\d+)月盘点/);
        return m && parseInt(m[1], 10) === endMonth;
      });
      if (sameMonthCheck.length > 0) {
        rows = applyCheckAdjustments(rows, sameMonthCheck);
      }
    }

    const body: SummaryResponse = {
      rows,
      warehouses,
      meta: {
        startDate,
        endDate,
        sourceCount: filtered.length,
        groupCount: rows.length,
      },
    };

    console.log(`[summary] done (${Date.now() - t0}ms)`);
    return NextResponse.json(body);
  } catch (error) {
    console.error("[summary]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
