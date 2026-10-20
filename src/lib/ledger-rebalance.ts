import type { LedgerRow } from "./types";

const CHECK_NATURES = new Set(["盘盈", "盘亏"]);

/**
 * Sort ledger rows by chronology: date asc, then applyTime, then applyNum,
 * then applyId. Within the same date the larger applyNum/applyId represents
 * the most recent update — this is how we pick "yesterday's closing".
 */
function compareLedger(
  a: { date: string; applyTime: string; applyNum: string; applyId: string },
  b: { date: string; applyTime: string; applyNum: string; applyId: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.applyTime !== b.applyTime) return a.applyTime < b.applyTime ? -1 : 1;
  if (a.applyNum !== b.applyNum) return a.applyNum < b.applyNum ? -1 : 1;
  return a.applyId < b.applyId ? -1 : a.applyId > b.applyId ? 1 : 0;
}

/**
 * Recompute opening/closing for every non-check ledger row so that:
 *   1. Rows are grouped by (productCode, storeName|warehouse).
 *   2. Within each group rows are sorted by (date, applyTime, applyNum, applyId).
 *      Within the same date the largest applyNum / applyId is the latest.
 *   3. The first non-check row keeps its original opening (this is the
 *      legitimate start-of-window balance we cannot infer from elsewhere).
 *   4. For each subsequent row, opening is set to the *previous* row's
 *      (recomputed) closing — guaranteeing "today's opening = yesterday's
 *      closing" even when yesterday had multiple ledger entries (some
 *      inbound, some outbound).
 *   5. closing = opening + inbound - outbound for every non-check row.
 *   6. 盘盈 / 盘亏 check rows have no meaningful opening/closing chain;
 *      their values are left untouched so downstream consumers (e.g. the
 *      month-end 盘点 drill-down) keep working.
 *
 * The function mutates and returns the input array.
 */
export function recomputeOpeningClosing(rows: LedgerRow[]): LedgerRow[] {
  const groups = new Map<string, LedgerRow[]>();

  for (const r of rows) {
    const location = r.storeName || r.warehouse || "";
    const key = `${r.productCode}||${location}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(r);
  }

  for (const bucket of groups.values()) {
    bucket.sort(compareLedger);

    let prevClose: number | null = null;
    for (const r of bucket) {
      if (CHECK_NATURES.has(r.nature)) continue;

      const opening: number = prevClose === null ? (r.opening ?? 0) : prevClose;
      const closing: number = opening + (r.inbound || 0) - (r.outbound || 0);
      r.opening = opening;
      r.closing = closing;
      prevClose = closing;
    }
  }

  return rows;
}
