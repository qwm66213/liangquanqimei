/**
 * 轻流开放 API 读取工具（只读）。
 *
 * 与现有 src/lib/qingflow.ts 保持同样的调用方式，但独立一份，
 * 避免改动现有看板链路。
 */

export type QfValue = {
  value?: string | null;
  dataValue?: string | null;
  id?: number | null;
  optionId?: number | null;
};

export type QfReferValue = {
  applyId?: string | number | null;
  dataTitle?: string | null;
};

export type QfAnswer = {
  queId: number;
  queTitle?: string;
  queType?: number;
  values?: QfValue[];
  tableValues?: QfAnswer[][];
  referValues?: QfReferValue[];
};

export type QfRow = {
  applyId: string | number;
  answers?: QfAnswer[];
  applyBaseInfo?: {
    applyNum?: string;
    applyTime?: string;
    lastUpdateTime?: string;
    formTitle?: string;
  };
};

function baseUrl(): string {
  return process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";
}

function accessToken(): string {
  const token = process.env.QINGFLOW_ACCESS_TOKEN;
  if (!token) throw new Error("Missing env: QINGFLOW_ACCESS_TOKEN");
  return token;
}

/** 分页拉取应用全部数据（只读） */
export async function filterAllRows(
  appKey: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<QfRow[]> {
  const pageSize = options.pageSize ?? 200;
  const maxPages = options.maxPages ?? 100;
  const rows: QfRow[] = [];
  let pageNum = 1;
  let pageAmount = 1;

  while (pageNum <= pageAmount && pageNum <= maxPages) {
    const res = await fetch(`${baseUrl()}/app/${appKey}/apply/filter`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        accessToken: accessToken(),
      },
      body: JSON.stringify({ pageSize, pageNum, type: 8, queries: [] }),
      cache: "no-store",
    });
    const text = await res.text();
    let json: {
      errCode?: number;
      errMsg?: string | null;
      result?: { pageAmount?: number; result?: QfRow[] } | null;
    };
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Qingflow filter 返回非 JSON: ${text.slice(0, 200)}`);
    }
    if (json.errCode !== 0) {
      throw new Error(`Qingflow filter 失败 (errCode ${json.errCode}): ${json.errMsg ?? text.slice(0, 200)}`);
    }
    pageAmount = json.result?.pageAmount ?? 1;
    rows.push(...(json.result?.result ?? []));
    if (pageNum >= 100) break;
    pageNum += 1;
  }

  return rows;
}

/** 取第一个值（value 优先，回退 dataValue） */
export function pickValue(row: QfRow, queId: number): string | null {
  const answer = (row.answers ?? []).find((item) => item.queId === queId);
  const first = answer?.values?.[0];
  if (!first) return null;
  const raw = first.value ?? first.dataValue;
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

/** 取数字，非法返回 null */
export function pickNumber(row: QfRow, queId: number): number | null {
  const raw = pickValue(row, queId);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 取关联字段的记录 ID（关联引用/关联查询字段） */
export function pickReferId(row: QfRow, queId: number): string | null {
  const answer = (row.answers ?? []).find((item) => item.queId === queId);
  const refer = answer?.referValues?.[0]?.applyId;
  if (refer != null && String(refer) !== "") return String(refer);
  const value = answer?.values?.[0]?.value;
  return value != null && String(value).trim() !== "" ? String(value).trim() : null;
}

/** 取子表行 */
export function pickTableRows(row: QfRow, queId: number): QfAnswer[][] {
  const answer = (row.answers ?? []).find((item) => item.queId === queId);
  return answer?.tableValues ?? [];
}

/** 从「子表行」中取值 */
export function pickCellValue(cells: QfAnswer[], queId: number): string | null {
  const cell = cells.find((item) => item.queId === queId);
  const first = cell?.values?.[0];
  if (!first) return null;
  const raw = first.value ?? first.dataValue;
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

export function pickCellNumber(cells: QfAnswer[], queId: number): number | null {
  const raw = pickCellValue(cells, queId);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
