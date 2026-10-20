/**
 * 轻流开放 API 写入（创建客户采购申请单据）。
 *
 * 报文规则（沿用项目既有线上验证结论）：
 *  1. 数字字段去浮点尾数（4.00000000 → 4），否则轻流报 40502
 *  2. 文本字段 values 只传 { value }，不带空串
 *  3. 关联字段（queType 19）直接传展示名称
 *  4. 子表（queType 18）用 tableValues 逐行提交
 */

import { PURCHASE_APP_KEY, PURCHASE_ITEM_QUE, PURCHASE_QUE } from "./purchase-fields";
import { round4 } from "./purchase-pricing";

const EMPTY_APPLY_USER = { email: "", areaCode: "", mobile: "" };

type WriteAnswer = {
  queId: number;
  queTitle?: string;
  queType: number;
  values?: { value: unknown }[];
  tableValues?: { queId: number; queTitle?: string; queType: number; values: { value: unknown }[] }[][];
};

function baseUrl(): string {
  return process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";
}

function accessToken(): string {
  const token = process.env.QINGFLOW_ACCESS_TOKEN;
  if (!token) throw new Error("Missing env: QINGFLOW_ACCESS_TOKEN");
  return token;
}

/** 数字字段：4 位精度 + 去浮点尾数 */
function toQfNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = round4(value);
  return Number.isInteger(rounded) ? rounded : Number(rounded.toFixed(4));
}

function cell(queId: number, queType: number, value: unknown) {
  return { queId, queTitle: "", queType, values: [{ value }] };
}

export type PurchaseApplyLine = {
  productCode: string;
  productName: string;
  spec: string;
  baseUnit: string;
  baseUnitCode: string;
  qty: number;
  purchasePrice: number;
  factor: number;
  /** 命中商品加价系数时填写，否则留空 */
  markupFactor: number | null;
  customerUnitPrice: number;
  customerAmount: number;
};

export type PurchaseApplyInput = {
  customerName: string;
  storeName: string;
  /** 「客户」：写入新增的单行文本字段（值取客户端基础信息·客户，如 粮全其美国展） */
  customerLabel?: string;
  storeCode?: string;
  warehouseName: string;
  warehouseCode: string;
  /** 出库仓管：单行文本字段，直接写名称（如 范娅娅） */
  warehouseKeeper: string;
  deliveryDate: string;
  factor: number;
  totalQty: number;
  totalCustomerAmount: number;
  lines: PurchaseApplyLine[];
};

/** 构造 openAPI 写入请求体 */
export function buildPurchaseApplyBody(input: PurchaseApplyInput) {
  const answers: WriteAnswer[] = [];

  const push = (queId: number, queType: number, value: unknown) => {
    if (value == null || value === "") return;
    answers.push(cell(queId, queType, value));
  };

  push(PURCHASE_QUE.customerName, 2, input.customerName);
  // 「客户」：单行文本字段（值取客户端基础信息·客户）
  if (input.customerLabel) push(PURCHASE_QUE.customerText, 2, input.customerLabel);
  push(PURCHASE_QUE.storeName, 2, input.storeName);
  if (input.storeCode) push(PURCHASE_QUE.storeCode, 2, input.storeCode);
  push(PURCHASE_QUE.priceFactor, 8, toQfNumber(input.factor));
  push(PURCHASE_QUE.totalQty, 8, toQfNumber(input.totalQty));
  push(PURCHASE_QUE.totalCustomer, 8, toQfNumber(input.totalCustomerAmount));
  push(PURCHASE_QUE.warehouse, 19, input.warehouseName);
  push(PURCHASE_QUE.warehouseCode, 2, input.warehouseCode);
  push(PURCHASE_QUE.warehouseKeeper, 2, input.warehouseKeeper);
  push(PURCHASE_QUE.deliveryDate, 4, input.deliveryDate);

  const tableValues: WriteAnswer["tableValues"] = input.lines.map((line) => {
    const row: NonNullable<WriteAnswer["tableValues"]>[number] = [];
    row.push(cell(PURCHASE_ITEM_QUE.productCode, 2, line.productCode));
    row.push(cell(PURCHASE_ITEM_QUE.productName, 19, line.productName));
    row.push(cell(PURCHASE_ITEM_QUE.spec, 2, line.spec));
    row.push(cell(PURCHASE_ITEM_QUE.outUnit, 2, line.baseUnit));
    if (line.baseUnit) row.push(cell(PURCHASE_ITEM_QUE.baseUnit, 2, line.baseUnit));
    if (line.baseUnitCode) row.push(cell(PURCHASE_ITEM_QUE.unitCode, 2, line.baseUnitCode));
    row.push(cell(PURCHASE_ITEM_QUE.qty, 8, toQfNumber(line.qty)));
    row.push(cell(PURCHASE_ITEM_QUE.purchasePrice, 8, toQfNumber(line.purchasePrice)));
    row.push(cell(PURCHASE_ITEM_QUE.priceFactor, 8, toQfNumber(line.factor)));
    if (line.markupFactor != null) {
      row.push(cell(PURCHASE_ITEM_QUE.markupFactor, 2, String(line.markupFactor)));
    }
    row.push(cell(PURCHASE_ITEM_QUE.customerUnitPrice, 8, toQfNumber(line.customerUnitPrice)));
    row.push(cell(PURCHASE_ITEM_QUE.customerAmount, 8, toQfNumber(line.customerAmount)));
    return row;
  });

  if (tableValues && tableValues.length > 0) {
    answers.push({
      queId: PURCHASE_QUE.items,
      queTitle: "",
      queType: 18,
      values: [],
      tableValues,
    });
  }

  return { applyUser: EMPTY_APPLY_USER, answers };
}

/** 创建单据，返回 requestId（需轮询确认） */
export async function createPurchaseApply(input: PurchaseApplyInput): Promise<{ requestId: string }> {
  const body = buildPurchaseApplyBody(input);
  const keeperAnswer = body.answers.find((item) => item.queId === PURCHASE_QUE.warehouseKeeper);
  console.log("[purchase-write] 出库仓管提交值:", JSON.stringify(keeperAnswer?.values ?? null));

  const response = await fetch(`${baseUrl()}/app/${PURCHASE_APP_KEY}/apply`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      accessToken: accessToken(),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  console.log("[purchase-write] 创建响应:", text.slice(0, 600));
  let data: { errCode?: number; errMsg?: string | null; result?: { requestId?: string } | null } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { errCode: -1, errMsg: text };
  }
  if (!response.ok || data.errCode !== 0) {
    console.error("[purchase-write] 创建失败，请求报文:", JSON.stringify(body).slice(0, 2000));
    throw new Error(
      `轻流创建单据失败 (HTTP ${response.status}, errCode ${data.errCode}): ${data.errMsg ?? text.slice(0, 300)}`,
    );
  }
  const requestId = data.result?.requestId;
  if (!requestId) throw new Error(`轻流创建单据未返回 requestId: ${text.slice(0, 300)}`);
  return { requestId };
}

/** 轮询写入结果 */
export async function pollOperation(
  requestId: string,
  options: { times?: number; intervalMs?: number } = {},
): Promise<{ ok: boolean; applyId: string | null; message: string }> {
  const times = options.times ?? 6;
  const intervalMs = options.intervalMs ?? 2000;

  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const response = await fetch(`${baseUrl()}/operation/${requestId}`, {
      headers: { Accept: "application/json", accessToken: accessToken() },
      cache: "no-store",
    });
    const text = await response.text();
    let data: { errorCode?: number; message?: string; result?: unknown } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (data.errorCode === 0) {
      const applyId = Array.isArray(data.result) ? String(data.result[0]) : String(data.result ?? "");
      return { ok: true, applyId: applyId || null, message: "" };
    }
    if (data.errorCode != null) {
      return { ok: false, applyId: null, message: data.message ?? `errorCode=${data.errorCode}` };
    }
  }
  return { ok: false, applyId: null, message: `轮询超时（${times} 次）` };
}
