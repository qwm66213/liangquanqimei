/**
 * 轻流 BPS 入库单据历史查询（主流程应用 e04doio3ps02）
 *
 * 职责：按采购订单号(poNo)查询该采购单已写入的入库单据明细，
 * 用于「整单入库状态」的累计判定——
 *   同一采购单分多批发货时，第二次/补发报文里的 items[].planQty 仍是全单计划，
 *   仅凭当前报文无法判断整单是否已到齐；需叠加历史单据已入库数量再对比。
 *
 * 返回：各历史单据的商品明细行（商品/订单数/入库数），由调用方做累计聚合。
 * 数据源优先级：
 *   1. 单据子表单「入库明细」（含 itemCode，精确）
 *   2. 子表单不可用时回退解析备注文本（“部分入库\n商品名 计划X 实收Y 少发Z”）
 *
 * 注意：历史查询只是入库状态增强，失败不应阻断写入主链路（调用方需 catch）。
 */

import type { BpsFieldConfig, InboundHistoryRow } from "./bps-parser";
import { DEFAULT_BPS_APP_KEY } from "./bps-config";

type Answer = {
  queId?: number | string;
  queType?: number | string;
  values?: { value?: unknown; dataValue?: unknown }[];
  tableValues?: unknown;
};

type ApplyRow = {
  applyId?: string | number;
  answers?: Answer[];
};

type FilterResponse = {
  errCode: number;
  errMsg?: string | null;
  result?: {
    pageAmount?: number;
    pageNum?: number;
    result?: ApplyRow[];
  } | null;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 取主表某个 queId 的文本值 */
function pickMain(answers: Answer[] | undefined, queId: number): string {
  const a = answers?.find((x) => Number(x.queId) === queId);
  const first = a?.values?.[0];
  if (!first) return "";
  const raw = first.value ?? first.dataValue;
  return raw == null ? "" : String(raw).trim();
}

/** 取子表单某行单元格里某个 queId 的值 */
function pickCell(cells: Answer[] | undefined, queId: number): string {
  if (!Array.isArray(cells)) return "";
  for (const c of cells) {
    if (Number(c.queId) !== queId) continue;
    const first = c.values?.[0];
    const raw = first?.value ?? first?.dataValue;
    if (raw == null) continue;
    const text = String(raw).trim();
    if (text !== "") return text;
  }
  return "";
}

/** 备注明细行格式：“商品名 计划24 实收4 少发20” */
const REMARK_ROW_RE = /^(.+?)\s*计划([\d.]+)\s*实收([\d.]+)\s*少发([\d.]+)$/;

/** 备注文本 → 明细行（跳过“部分入库/全部入库”首行） */
function remarkToRows(remark: string): InboundHistoryRow[] {
  const lines = String(remark ?? "").split("\n");
  const rows: InboundHistoryRow[] = [];
  for (const line of lines) {
    if (line.trim() === "" || line.includes("入库")) continue;
    const m = line.match(REMARK_ROW_RE);
    if (!m) continue;
    rows.push({
      itemCode: "",
      itemName: m[1].trim(),
      planQty: toNumber(m[2]),
      actualQty: toNumber(m[3]),
    });
  }
  return rows;
}

/** 把 filter 返回的一条单据解析为明细行 */
function applyToRows(apply: ApplyRow, fields: BpsFieldConfig): InboundHistoryRow[] {
  const { subQue } = fields;
  const answers = apply.answers ?? [];

  // 优先子表单「入库明细」：tableValues 为二维数组（每行一个单元格数组）
  const table = answers.find((a) => Number(a.queId) === subQue.tableId);
  const tableValues = Array.isArray(table?.tableValues) ? table.tableValues : [];
  if (tableValues.length > 0) {
    const rows: InboundHistoryRow[] = [];
    for (const rawRow of tableValues) {
      if (!Array.isArray(rawRow)) continue;
      const cells = rawRow as Answer[];
      const itemCode = pickCell(cells, subQue.itemCode);
      const itemName = pickCell(cells, subQue.itemName);
      if (!itemCode && !itemName) continue;
      rows.push({
        itemCode,
        itemName,
        planQty: toNumber(pickCell(cells, subQue.planQty)),
        actualQty: toNumber(pickCell(cells, subQue.actualQty)),
      });
    }
    if (rows.length > 0) return rows;
  }

  // 回退：解析备注文本（历史老单据可能无子表单/子表单为空）
  return remarkToRows(pickMain(answers, fields.que.remark));
}

/**
 * 按采购订单号(poNo)查询历史入库单据的商品明细行（跨单据平铺）。
 * @returns 历史单据明细行数组（可能为空数组）
 */
export async function fetchInboundByPoNo(
  poNo: string,
  opt?: { appKey?: string; fields?: BpsFieldConfig },
): Promise<InboundHistoryRow[]> {
  if (!poNo) return [];
  const fields = opt?.fields;
  if (!fields) return [];

  const appKey = opt?.appKey ?? DEFAULT_BPS_APP_KEY;
  const accessToken = env("QINGFLOW_ACCESS_TOKEN");
  const baseUrl = process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";

  const pageSize = 100;
  let pageNum = 1;
  let pageAmount = 1;
  const rows: InboundHistoryRow[] = [];

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
        queriesRel: "and",
        queries: [
          {
            queId: String(fields.que.poNo),
            searchKeys: [poNo],
          },
        ],
      }),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Qingflow HTTP ${response.status}`);
    const data = (await response.json()) as FilterResponse;
    if (data.errCode !== 0 || !data.result) {
      throw new Error(data.errMsg || `Qingflow errCode ${data.errCode}`);
    }

    pageAmount = data.result.pageAmount || 1;
    for (const apply of data.result.result ?? []) {
      // searchKeys 为模糊匹配时做一次精确过滤，防止混入相似单号
      const mainPoNo = pickMain(apply.answers, fields.que.poNo);
      if (mainPoNo !== poNo) continue;
      rows.push(...applyToRows(apply, fields));
    }
    pageNum += 1;
  }

  return rows;
}
