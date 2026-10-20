import { NextRequest, NextResponse } from "next/server";
import { aggregateStoreSummary, collectStores, applyStoreCheckAdjustments } from "@/lib/store-aggregate";
import { fetchStoreLedgerRows, fetchStoreCheckLedgerRows } from "@/lib/store-qingflow";
import type { StoreSummaryRow, StoreSummaryResponse } from "@/lib/types";

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
    const storeName = searchParams.get("storeName")?.trim() || undefined;
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

    // Fetch normal (非盘点) records: storeName + productCode + date + empty remarks
    // 正常流水数据：备注为空，排除盘点记录
    const tFetch = Date.now();
    const ledger = await fetchStoreLedgerRows({
      endDate,
      productCode,
      productName,
      storeName,
    });
    // 过滤掉盘点记录（备注非空），盘点数据由单独的检查逻辑处理
    const normalLedger = ledger.filter((row) => !row.remarks || row.remarks === "");
    console.log(`[store-summary] fetchStoreLedgerRows: ${ledger.length} raw -> ${normalLedger.length} normal (${Date.now() - tFetch}ms)`);

    // Fetch 盘点 rows: always check end-month + previous month
    // (盘点 records may be entered next month, so no date filter here)
    const endMonth = parseInt(endDate.slice(5, 7), 10);
    const prevMonth = endMonth === 1 ? 12 : endMonth - 1;
    const startMonth = parseInt(startDate.slice(5, 7), 10);

    const tCheck = Date.now();
    const allCheckRows = await fetchStoreCheckLedgerRows(endMonth, storeName);
    if (prevMonth !== endMonth) {
      const prevRows = await fetchStoreCheckLedgerRows(prevMonth, storeName);
      const seen = new Set(allCheckRows.map((r) => r.applyId));
      for (const r of prevRows) {
        if (!seen.has(r.applyId)) allCheckRows.push(r);
      }
    }
    console.log(`[store-summary] fetchStoreCheckLedgerRows (${endMonth}月+${prevMonth}月): ${allCheckRows.length} rows (${Date.now() - tCheck}ms)`);

    const stores = collectStores(normalLedger);

    const filtered = normalLedger;

    let rows: StoreSummaryRow[] = aggregateStoreSummary(filtered, startDate, endDate);

    // Check rows are already filtered by storeName at API level; keep as safety net
    const storeFilteredCheck = storeName
      ? allCheckRows.filter((row) => row.storeName === storeName)
      : allCheckRows;

    // Apply check adjustments only when the query reaches month-end.
    // 盘点数据是月末修正，查询月中区间时不应注入。
    const endDay = parseInt(endDate.slice(8, 10), 10);
    const lastDayOfMonth = new Date(parseInt(endDate.slice(0, 4)), endMonth, 0).getDate();
    const isMonthEnd = endDay === lastDayOfMonth;

    // Previous-month checks: use check count (inbound) as verified opening
    // 上月盘点数 = 本月初实际库存，直接覆盖期初
    // check details for drill-down only attached at month-end
    const prevMonthCheck = storeFilteredCheck.filter((cr) => {
      const m = cr.remarks?.match(/(\d+)月盘点/);
      const cm = m ? parseInt(m[1], 10) : 0;
      return cm > 0 && cm < startMonth;
    });
    if (prevMonthCheck.length > 0) {
      const rowMap = new Map<string, StoreSummaryRow>();
      for (const row of rows) {
        rowMap.set(`${row.productCode}||${row.storeName}`, row);
      }
      for (const cr of prevMonthCheck) {
        const key = `${cr.productCode}||${cr.storeName ?? ""}`;
        const target = rowMap.get(key);
        if (!target) continue;
        const checkQty = cr.inbound; // 盘点数 = 入库字段值
        target.opening = checkQty;
        target.closing = target.opening + target.inbound - target.outbound;

        // Only attach drill-down data at month-end
        if (isMonthEnd) {
          if (!target.checks) target.checks = [];
          target.checks.push({
            nature: "盘点",
            quantity: checkQty,
            period: cr.remarks || "",
            date: cr.date,
          });
        }
      }
    }

    // Same-month checks: adjustments + drill-down display, only at month-end
    if (isMonthEnd) {
      const sameMonthCheck = storeFilteredCheck.filter((cr) => {
        const m = cr.remarks?.match(/(\d+)月盘点/);
        return m && parseInt(m[1], 10) === endMonth;
      });
      if (sameMonthCheck.length > 0) {
        rows = applyStoreCheckAdjustments(rows, sameMonthCheck);
      }
    }

    const body: StoreSummaryResponse = {
      rows,
      stores,
      meta: {
        startDate,
        endDate,
        sourceCount: filtered.length,
        groupCount: rows.length,
      },
    };

    console.log(`[store-summary] done (${Date.now() - t0}ms)`);
    return NextResponse.json(body);
  } catch (error) {
    console.error("[store-summary]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
