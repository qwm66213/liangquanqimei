import type { LedgerRow, SummaryRow } from "./types";

function compareRows(a: LedgerRow, b: LedgerRow): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.applyTime !== b.applyTime) return a.applyTime < b.applyTime ? -1 : 1;
  if (a.applyNum !== b.applyNum) return a.applyNum < b.applyNum ? -1 : 1;
  return a.applyId < b.applyId ? -1 : a.applyId > b.applyId ? 1 : 0;
}

export function resolveOpening(row: LedgerRow): number {
  if (row.opening != null) return row.opening;
  if (row.closing != null) return row.closing - row.inbound + row.outbound;
  return 0;
}

export function resolveClosing(row: LedgerRow): number {
  if (row.closing != null) return row.closing;
  return resolveOpening(row) + row.inbound - row.outbound;
}

/**
 * Aggregate all ledger rows (including pre-range data) into product+warehouse summaries.
 * - opening: latest closing from before startDate (or first row's opening if none)
 * - closing: latest closing from within [startDate, endDate] (or opening if no in-range rows)
 * - inbound/outbound: sum of only in-range rows
 * - Products with pre-range data but zero in-range transactions are still included.
 */
export function aggregateSummary(
  rows: LedgerRow[],
  startDate: string,
  endDate: string = startDate,
): SummaryRow[] {
  // Group ALL rows by productCode + warehouse
  const groups = new Map<string, LedgerRow[]>();

  for (const row of rows) {
    const key = `${row.productCode}||${row.warehouse}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const summaries: SummaryRow[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort(compareRows);

    const beforeRange = sorted.filter((r) => r.date < startDate);
    const inRange = sorted.filter((r) => r.date >= startDate && r.date <= endDate);

    // Opening: latest closing from the day before startDate
    let opening = 0;
    if (beforeRange.length > 0) {
      const prevRow = beforeRange[beforeRange.length - 1];
      opening = resolveClosing(prevRow);
    } else if (inRange.length > 0) {
      opening = resolveOpening(inRange[0]);
    }

    // Closing: latest closing within [startDate, endDate], or fallback to opening
    let closing = opening;
    if (inRange.length > 0) {
      const lastInRange = inRange[inRange.length - 1];
      closing = resolveClosing(lastInRange);
    }

    // Inbound/outbound: only rows within [startDate, endDate]
    const inbound = inRange.reduce((sum, row) => sum + row.inbound, 0);
    const outbound = inRange.reduce((sum, row) => sum + row.outbound, 0);

    const first = sorted[0];
    const productName =
      sorted.find((row) => row.productName)?.productName ?? first.productName;

    summaries.push({
      productCode: first.productCode,
      productName,
      warehouse: first.warehouse,
      opening,
      closing,
      inbound,
      outbound,
    });
  }

  summaries.sort((a, b) => {
    if (a.warehouse !== b.warehouse) return a.warehouse.localeCompare(b.warehouse, "zh");
    return a.productCode.localeCompare(b.productCode, "zh");
  });

  return summaries;
}

/**
 * Apply check/盘点 adjustments to aggregated summaries.
 * - 盘盈 records: add their inbound to the group's inbound
 * - 盘亏 records: add their outbound to the group's outbound
 * - Recalculate closing after adjustment
 * - Opening and closing from check rows are ignored.
 * - Attach check details to each row for drill-down display.
 */
export function applyCheckAdjustments(
  summaries: SummaryRow[],
  checkRows: LedgerRow[],
): SummaryRow[] {
  // Build lookup: productCode||warehouse -> SummaryRow
  const map = new Map<string, SummaryRow>();
  for (const row of summaries) {
    map.set(`${row.productCode}||${row.warehouse}`, row);
  }

  for (const cr of checkRows) {
    const key = `${cr.productCode}||${cr.warehouse}`;
    const target = map.get(key);
    if (!target) continue;

    const nature = cr.nature;
    const qty = nature === "盘盈" ? cr.inbound : cr.outbound;

    if (nature === "盘盈") {
      target.inbound += cr.inbound;
    } else if (nature === "盘亏") {
      target.outbound += cr.outbound;
    }

    // Recalculate closing after adjustment
    target.closing = target.opening + target.inbound - target.outbound;

    // Attach check detail for drill-down
    if (!target.checks) target.checks = [];
    target.checks.push({
      nature: cr.nature,
      quantity: qty,
      period: cr.remarks || "",
      date: cr.date,
    });
  }

  return summaries;
}

export function collectWarehouses(rows: LedgerRow[]): string[] {
  return [...new Set(rows.map((row) => row.warehouse).filter((s): s is string => s != null))].sort((a, b) =>
    a.localeCompare(b, "zh"),
  );
}
