/**
 * 客户采购价计算（纯函数，口径集中在此）。
 *
 * 口径（与业务确认一致）：
 *   客户采购单价 = 进货单价 × (商品加价系数 存在且 ≠ 0 ? 商品加价系数 : 门店采购系数)
 *   客户采购金额 = 客户采购单价 × 采购数量
 *   本次发货总量 = Σ 采购数量；本次发货总额 = Σ 客户采购金额
 *   小数位：保留 4 位
 */

export const DECIMALS = 4;

/** 四舍五入到 4 位（避免浮点尾差） */
export function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 10 ** DECIMALS) / 10 ** DECIMALS;
}

/** 数字解析：空/非法/0 均视为“空”（业务要求 0 视同空） */
export function parseFactor(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/** 门店名称归一化：去空白、全角转半角、去掉“中心/门店”等修饰后用于兜底匹配 */
export function normalizeStoreName(raw: string | null | undefined): string {
  if (!raw) return "";
  const half = String(raw)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "")
    .trim();
  return half;
}

/** 归一化 + 去修饰词（第二级匹配） */
export function looseStoreName(raw: string | null | undefined): string {
  return normalizeStoreName(raw)
    .replace(/中心/g, "")
    .replace(/门店/g, "")
    .replace(/店$/g, "");
}

/**
 * 解析生效系数：加价系数优先；为空/非数字/0 时回落门店采购系数。
 * 两者都取不到时返回 null（调用方需提示“未配置采购系数”，不得当成 0 使用）。
 */
export function resolveFactor(params: {
  markupFactor: string | number | null | undefined;
  storeFactor: string | number | null | undefined;
}): { factor: number | null; source: "markup" | "store" | "missing" } {
  const markup = parseFactor(params.markupFactor);
  if (markup != null) return { factor: markup, source: "markup" };
  const store = parseFactor(params.storeFactor);
  if (store != null) return { factor: store, source: "store" };
  return { factor: null, source: "missing" };
}

export type PricedLine = {
  qty: number;
  purchasePrice: number;
  customerUnitPrice: number;
  customerAmount: number;
};

/** 行价格计算（4 位） */
export function calcLine(params: {
  purchasePrice: number;
  qty: number;
  factor: number;
}): PricedLine {
  const qty = Number.isFinite(params.qty) ? params.qty : 0;
  const unitPrice = round4(params.purchasePrice * params.factor);
  const amount = round4(unitPrice * qty);
  return {
    qty,
    purchasePrice: round4(params.purchasePrice),
    customerUnitPrice: unitPrice,
    customerAmount: amount,
  };
}

/** 汇总（4 位） */
export function summarize(lines: { qty: number; customerAmount: number }[]): {
  totalQty: number;
  totalAmount: number;
} {
  let totalQty = 0;
  let totalAmount = 0;
  for (const line of lines) {
    totalQty = round4(totalQty + (Number.isFinite(line.qty) ? line.qty : 0));
    totalAmount = round4(totalAmount + (Number.isFinite(line.customerAmount) ? line.customerAmount : 0));
  }
  return { totalQty, totalAmount };
}
