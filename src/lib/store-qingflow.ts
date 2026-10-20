import { STORE_QUE } from "./store-fields";
import type { LedgerRow } from "./types";

type QingflowValue = {
  value?: string | null;
  dataValue?: string | null;
};

type QingflowAnswer = {
  queId: number;
  queTitle?: string;
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

export function mapStoreApplyToLedger(apply: QingflowApply): LedgerRow | null {
  const answers = apply.answers ?? [];
  const productCode = pickValue(answers, STORE_QUE.productCode) ?? "";
  const warehouse = pickValue(answers, STORE_QUE.warehouse) ?? "";
  const storeName = pickValue(answers, STORE_QUE.storeName) ?? "";
  const date = normalizeDate(pickValue(answers, STORE_QUE.date));
  if (!productCode || !storeName || !date) return null;

  const opening = toNumber(pickValue(answers, STORE_QUE.opening));
  const closing = toNumber(pickValue(answers, STORE_QUE.closing));
  const inbound = toNumber(pickValue(answers, STORE_QUE.inbound)) ?? 0;
  const outbound = toNumber(pickValue(answers, STORE_QUE.outbound)) ?? 0;

  return {
    applyId: String(apply.applyId),
    applyNum: pickValue(answers, STORE_QUE.applyNum) ?? "",
    productCode,
    productName: pickValue(answers, STORE_QUE.productName) ?? "",
    warehouse,
    storeName: storeName || undefined,
    nature: pickValue(answers, STORE_QUE.nature) ?? "",
    date,
    applyTime: pickValue(answers, STORE_QUE.applyTime) ?? "",
    opening,
    closing,
    inbound,
    outbound,
    remarks: pickValue(answers, STORE_QUE.remarks) ?? undefined,
    deliveryType: pickValue(answers, STORE_QUE.deliveryType) ?? undefined,
  };
}

export type FetchStoreLedgerParams = {
  startDate?: string;
  endDate: string;
  storeName?: string;
  productCode?: string;
  productName?: string;
};

export async function fetchStoreLedgerRows(params: FetchStoreLedgerParams): Promise<LedgerRow[]> {
  const appKey = env("QINGFLOW_STORE_APP_KEY");
  const accessToken = env("QINGFLOW_ACCESS_TOKEN");
  const baseUrl = process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";

  const dateQuery: Record<string, unknown> = {
    queId: String(STORE_QUE.date),
    maxValue: `${params.endDate} 23:59:59`,
    queType: 4,
    scope: 1,
  };
  if (params.startDate) {
    dateQuery.minValue = `${params.startDate} 00:00:00`;
  }

  const queries: Record<string, unknown>[] = [dateQuery];

  if (params.storeName) {
    queries.push({
      queId: String(STORE_QUE.storeName),
      searchKeys: [params.storeName],
    });
  }
  if (params.productCode) {
    queries.push({
      queId: String(STORE_QUE.productCode),
      searchKeys: [params.productCode],
    });
  }
  if (params.productName) {
    queries.push({
      queId: String(STORE_QUE.productName),
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
        sorts: [{ queId: String(STORE_QUE.date), isAscend: true }],
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
      const row = mapStoreApplyToLedger(apply);
      if (row) rows.push(row);
    }
    pageNum += 1;
  }

  return rows;
}

/**
 * Fetch store check (盘点) rows with specific remarks for a given month.
 * Mirrors warehouse fetchCheckLedgerRows: searches by remarks = "X月盘点".
 * When storeName is provided, also filters by store name at API level.
 */
export async function fetchStoreCheckLedgerRows(
  month: number,
  storeName?: string,
): Promise<LedgerRow[]> {
  const appKey = env("QINGFLOW_STORE_APP_KEY");
  const accessToken = env("QINGFLOW_ACCESS_TOKEN");
  const baseUrl = process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";

  const remarkText = `${month}月盘点`;
  const queries: Record<string, unknown>[] = [
    {
      queId: String(STORE_QUE.remarks),
      searchKeys: [remarkText],
    },
  ];

  if (storeName) {
    queries.push({
      queId: String(STORE_QUE.storeName),
      searchKeys: [storeName],
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
        sorts: [{ queId: String(STORE_QUE.date), isAscend: true }],
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
      const row = mapStoreApplyToLedger(apply);
      if (row) rows.push(row);
    }
    pageNum += 1;
  }

  return rows;
}
