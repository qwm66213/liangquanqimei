import { QUE } from "./fields";
import type { LedgerRow } from "./types";

type QingflowValue = {
  value?: string | null;
  dataValue?: string | null;
};

type QingflowAnswer = {
  queId: number;
  values?: QingflowValue[];
};

type QingflowApply = {
  applyId: string | number;
  answers?: QingflowAnswer[];
};

type FilterResult = {
  errCode: number;
  errMsg: string | null;
  result: {
    pageAmount: number;
    pageNum: number;
    pageSize: number;
    resultAmount: number;
    result: QingflowApply[];
  } | null;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function pickValue(answers: QingflowAnswer[] | undefined, queId: number): string | null {
  const answer = answers?.find((item) => item.queId === queId);
  const first = answer?.values?.[0];
  if (!first) return null;
  const raw = first.value ?? first.dataValue;
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

function toNumber(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(raw: string | null): string {
  if (!raw) return "";
  return raw.slice(0, 10);
}

export function mapApplyToLedger(apply: QingflowApply): LedgerRow | null {
  const answers = apply.answers ?? [];
  const productCode = pickValue(answers, QUE.productCode) ?? "";
  const warehouse = pickValue(answers, QUE.warehouse) ?? "";
  const date = normalizeDate(pickValue(answers, QUE.date));
  if (!productCode || !warehouse || !date) return null;

  return {
    applyId: String(apply.applyId),
    applyNum: pickValue(answers, QUE.applyNum) ?? "",
    productCode,
    productName: pickValue(answers, QUE.productName) ?? "",
    warehouse,
    nature: pickValue(answers, QUE.nature) ?? "",
    date,
    applyTime: pickValue(answers, QUE.applyTime) ?? "",
    opening: toNumber(pickValue(answers, QUE.opening)),
    closing: toNumber(pickValue(answers, QUE.closing)),
    inbound: toNumber(pickValue(answers, QUE.inbound)) ?? 0,
    outbound: toNumber(pickValue(answers, QUE.outbound)) ?? 0,
    remarks: pickValue(answers, QUE.remarks) ?? undefined,
  };
}

export type FetchLedgerParams = {
  startDate?: string;
  endDate: string;
  warehouse?: string;
  productCode?: string;
  productName?: string;
};

export async function fetchLedgerRows(params: FetchLedgerParams): Promise<LedgerRow[]> {
  const appKey = env("QINGFLOW_APP_KEY");
  const accessToken = env("QINGFLOW_ACCESS_TOKEN");
  const baseUrl = process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";

  const dateQuery: Record<string, unknown> = {
    queId: String(QUE.date),
    maxValue: `${params.endDate} 23:59:59`,
    queType: 4,
    scope: 1,
  };
  if (params.startDate) {
    dateQuery.minValue = `${params.startDate} 00:00:00`;
  }

  const queries: Record<string, unknown>[] = [dateQuery];

  if (params.warehouse) {
    queries.push({
      queId: String(QUE.warehouse),
      searchKeys: [params.warehouse],
    });
  }
  if (params.productCode) {
    queries.push({
      queId: String(QUE.productCode),
      searchKeys: [params.productCode],
    });
  }
  if (params.productName) {
    queries.push({
      queId: String(QUE.productName),
      searchKeys: [params.productName],
    });
  }

  const pageSize = 100;
  let pageNum = 1;
  let pageAmount = 1;
  const rows: LedgerRow[] = [];

  while (pageNum <= pageAmount) {
    const response = await fetch(`${baseUrl}/app/${appKey}/apply/filter`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        accessToken,
      },
      body: JSON.stringify({
        pageSize,
        pageNum,
        type: 8,
        sorts: [{ queId: String(QUE.date), isAscend: true }],
        queriesRel: "and",
        queries,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Qingflow HTTP ${response.status}`);
    }

    const data = (await response.json()) as FilterResult;
    if (data.errCode !== 0 || !data.result) {
      throw new Error(data.errMsg || `Qingflow errCode ${data.errCode}`);
    }

    pageAmount = data.result.pageAmount || 1;
    for (const apply of data.result.result) {
      const row = mapApplyToLedger(apply);
      if (row) rows.push(row);
    }
    pageNum += 1;
  }

  return rows;
}

/**
 * Fetch warehouse check (盘点) rows with specific remarks for a given month.
 * 盘盈/盘亏 records have remarks = "X月盘点", their opening/closing should be ignored.
 * When warehouse is provided, also filters by warehouse at API level.
 */
export async function fetchCheckLedgerRows(
  month: number,
  warehouse?: string,
): Promise<LedgerRow[]> {
  const appKey = env("QINGFLOW_APP_KEY");
  const accessToken = env("QINGFLOW_ACCESS_TOKEN");
  const baseUrl = process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";

  const remarkText = `${month}月盘点`;
  const queries: Record<string, unknown>[] = [
    {
      queId: String(QUE.remarks),
      searchKeys: [remarkText],
    },
  ];

  if (warehouse) {
    queries.push({
      queId: String(QUE.warehouse),
      searchKeys: [warehouse],
    });
  }

  const pageSize = 100;
  let pageNum = 1;
  let pageAmount = 1;
  const rows: LedgerRow[] = [];

  while (pageNum <= pageAmount) {
    const response = await fetch(`${baseUrl}/app/${appKey}/apply/filter`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        accessToken,
      },
      body: JSON.stringify({
        pageSize,
        pageNum,
        type: 8,
        sorts: [{ queId: String(QUE.date), isAscend: true }],
        queriesRel: "and",
        queries,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Qingflow HTTP ${response.status}`);
    }

    const data = (await response.json()) as FilterResult;
    if (data.errCode !== 0 || !data.result) {
      throw new Error(data.errMsg || `Qingflow errCode ${data.errCode}`);
    }

    pageAmount = data.result.pageAmount || 1;
    for (const apply of data.result.result) {
      const row = mapApplyToLedger(apply);
      if (row) rows.push(row);
    }
    pageNum += 1;
  }

  return rows;
}
