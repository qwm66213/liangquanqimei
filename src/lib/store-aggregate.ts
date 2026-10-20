import type { LedgerRow, StoreSummaryRow } from "./types";

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
 * Aggregate store ledger rows by productCode + storeName.
 * Same logic as warehouse: previous day closing → opening, all products included.
 */
export function aggregateStoreSummary(
  rows: LedgerRow[],
  startDate: string,
  endDate: string = startDate,
): StoreSummaryRow[] {
  const groups = new Map<string, LedgerRow[]>();

  for (const row of rows) {
    const key = `${row.productCode}||${row.storeName ?? ""}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const summaries: StoreSummaryRow[] = [];

  for (const group of groups.values()) {
    const sorted = [...group].sort(compareRows);

    const beforeRange = sorted.filter((r) => r.date < startDate);
    const inRange = sorted.filter((r) => r.date >= startDate && r.date <= endDate);

    let opening = 0;
    if (beforeRange.length > 0) {
      const prevRow = beforeRange[beforeRange.length - 1];
      opening = resolveClosing(prevRow);
    } else if (inRange.length > 0) {
      opening = resolveOpening(inRange[0]);
    }

    let closing = opening;
    if (inRange.length > 0) {
      const lastInRange = inRange[inRange.length - 1];
      closing = resolveClosing(lastInRange);
    }

    const inbound = inRange.reduce((sum, row) => sum + row.inbound, 0);
    const outbound = inRange.reduce((sum, row) => sum + row.outbound, 0);

    const first = sorted[0];
    const productName =
      sorted.find((row) => row.productName)?.productName ?? first.productName;

    summaries.push({
      productCode: first.productCode,
      productName,
      storeName: first.storeName ?? "",
      opening,
      closing,
      inbound,
      outbound,
    });
  }

  summaries.sort((a, b) => {
    if (a.storeName !== b.storeName) return a.storeName.localeCompare(b.storeName, "zh");
    return a.productCode.localeCompare(b.productCode, "zh");
  });

  return summaries;
}

export function collectStores(rows: LedgerRow[]): string[] {
  return [...new Set(rows.map((row) => row.storeName).filter((s): s is string => s != null))].sort((a, b) =>
    a.localeCompare(b, "zh"),
  );
}

/**
 * Apply store inventory check (盘点) to calculate outbound and correct closing.
 *
 * Store check logic differs from warehouse:
 * - Check record's inbound = actual inventory count (盘点数)
 * - outbound = opening + totalInbound - 盘点数 (反推，差额全计出库)
 * - closing = 盘点数 (直接覆盖)
 * - Opening/closing from check rows are ignored (user-filled transition data).
 */
export function applyStoreCheckAdjustments(
  summaries: StoreSummaryRow[],
  checkRows: LedgerRow[],
): StoreSummaryRow[] {
  const map = new Map<string, StoreSummaryRow>();
  for (const row of summaries) {
    map.set(`${row.productCode}||${row.storeName}`, row);
  }

  for (const cr of checkRows) {
    const key = `${cr.productCode}||${cr.storeName ?? ""}`;
    const target = map.get(key);
    if (!target) continue;

    const checkQty = cr.inbound; // 盘点数 = 入库字段值
    target.outbound = target.opening + target.inbound - checkQty;
    target.closing = checkQty;

    // 附带穿透数据
    if (!target.checks) target.checks = [];
    target.checks.push({
      nature: "盘点",
      quantity: checkQty,
      period: cr.remarks || "",
      date: cr.date,
    });
  }

  return summaries;
}
