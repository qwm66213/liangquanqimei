/**
 * 二开页面的基础取数与匹配层。
 *
 * 数据来源（全部通过轻流开放 API 只读获取）：
 *   商品列表  → 物料信息 e04doicnps01（状态=开启 且 配货类型=CP）
 *   出库仓库  → 仓库信息 e04doif7ps01
 *   门店系数  → 客户端基础信息 f808o0vtv001（按门店名称匹配）
 *   加价系数  → 物料加价信息 fjnh47157c01（按门店名称 + 商品匹配）
 */

import {
  CLIENT_APP_KEY,
  CLIENT_QUE,
  MARKUP_APP_KEY,
  MARKUP_QUE,
  MATERIAL_APP_KEY,
  MATERIAL_DELIVERY_TYPE_CP,
  MATERIAL_QUE,
  MATERIAL_STATUS_ON,
  WAREHOUSE_APP_KEY,
  WAREHOUSE_QUE,
} from "./purchase-fields";
import {
  filterAllRows,
  pickCellValue,
  pickNumber,
  pickTableRows,
  pickValue,
  type QfRow,
} from "./purchase-qingflow";
import { looseStoreName, normalizeStoreName, parseFactor, round4 } from "./purchase-pricing";
import type { CatalogItem, StorePricing, WarehouseOption } from "./purchase-types";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { at: number; value: T };

const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** 清缓存（调试/数据更新后使用） */
export function clearPurchaseCache(): void {
  cache.clear();
}

/* ---------------- 商品列表 ---------------- */

/** 可售商品：状态=开启 且 配货类型=CP */
export async function getCatalog(): Promise<CatalogItem[]> {
  return cached("catalog", async () => {
    const rows = await filterAllRows(MATERIAL_APP_KEY, { pageSize: 200 });
    const items: CatalogItem[] = [];
    for (const row of rows) {
      const status = pickValue(row, MATERIAL_QUE.status);
      const deliveryType = pickValue(row, MATERIAL_QUE.deliveryType);
      if (status !== MATERIAL_STATUS_ON) continue;
      if (deliveryType !== MATERIAL_DELIVERY_TYPE_CP) continue;

      const productCode = pickValue(row, MATERIAL_QUE.productCode);
      const productName = pickValue(row, MATERIAL_QUE.productName);
      if (!productCode || !productName) continue;

      items.push({
        productCode,
        productName,
        spec: pickValue(row, MATERIAL_QUE.spec) ?? "",
        baseUnit: pickValue(row, MATERIAL_QUE.baseUnit) ?? "",
        baseUnitCode: pickValue(row, MATERIAL_QUE.baseUnitCode) ?? "",
        purchasePrice: pickNumber(row, MATERIAL_QUE.purchasePrice) ?? 0,
      });
    }
    items.sort((a, b) => {
      const groupA = prefixGroup(a.productCode);
      const groupB = prefixGroup(b.productCode);
      if (groupA !== groupB) return groupA - groupB;
      return a.productCode.localeCompare(b.productCode, "zh-CN", { numeric: true });
    });
    return items;
  });
}

/**
 * 排序分组：S 开头（S01、S02、S03…）优先，F 开头（F01、F02、F03…）其次。
 * 当前可售商品只有这两类前缀（实测 S 组 108 条 + F 组 32 条 = 140 条），
 * 其它前缀仅作兜底排在最后。组内按商品编号自然序排列。
 */
function prefixGroup(productCode: string): number {
  const first = productCode.trim().charAt(0).toUpperCase();
  if (first === "S") return 0;
  if (first === "F") return 1;
  return 2;
}

export async function getCatalogItem(productCode: string): Promise<CatalogItem | null> {
  const items = await getCatalog();
  return items.find((item) => item.productCode === productCode) ?? null;
}

/* ---------------- 仓库 ---------------- */

export async function getWarehouseOptions(): Promise<WarehouseOption[]> {
  return cached("warehouses", async () => {
    const rows = await filterAllRows(WAREHOUSE_APP_KEY, { pageSize: 200 });
    const list: WarehouseOption[] = [];
    for (const row of rows) {
      const name = pickValue(row, WAREHOUSE_QUE.name);
      if (!name) continue;
      list.push({ name, code: pickValue(row, WAREHOUSE_QUE.code) ?? "" });
    }
    list.sort((a, b) => a.code.localeCompare(b.code));
    return list;
  });
}

export async function getWarehouseByName(name: string): Promise<WarehouseOption | null> {
  const list = await getWarehouseOptions();
  return list.find((item) => item.name === name) ?? null;
}

/* ---------------- 门店采购系数（客户端基础信息） ---------------- */

export async function getStorePricing(storeName: string): Promise<StorePricing> {
  const rows = await cached("client-rows", () => filterAllRows(CLIENT_APP_KEY, { pageSize: 200 }));
  return matchStorePricing(rows, storeName);
}

function matchStorePricing(rows: QfRow[], storeName: string): StorePricing {
  const exact = normalizeStoreName(storeName);
  const loose = looseStoreName(storeName);

  const pick = (candidate: QfRow): StorePricing => ({
    storeName,
    factor: parseFactor(pickValue(candidate, CLIENT_QUE.factor)),
    factorSource: parseFactor(pickValue(candidate, CLIENT_QUE.factor)) == null ? "invalid" : "found",
    recordId: String(candidate.applyId),
    customerLabel: pickValue(candidate, CLIENT_QUE.customer),
    customerName: pickValue(candidate, CLIENT_QUE.customerName),
  });

  for (const row of rows) {
    if (normalizeStoreName(pickValue(row, CLIENT_QUE.storeName)) === exact && exact !== "") {
      return pick(row);
    }
  }
  for (const row of rows) {
    const rowLoose = looseStoreName(pickValue(row, CLIENT_QUE.storeName));
    if (rowLoose !== "" && rowLoose === loose) return pick(row);
  }
  return { storeName, factor: null, factorSource: "missing" };
}

/* ---------------- 商品加价系数（物料加价信息） ---------------- */

type MarkupIndex = {
  byStoreProduct: Map<string, number>;
  byLooseStoreProduct: Map<string, number>;
};

async function getMarkupIndex(): Promise<MarkupIndex> {
  return cached("markup", async () => {
    const rows = await filterAllRows(MARKUP_APP_KEY, { pageSize: 200 });
    const byStoreProduct = new Map<string, number>();
    const byLooseStoreProduct = new Map<string, number>();

    for (const row of rows) {
      const factor = parseFactor(pickValue(row, MARKUP_QUE.factor));
      if (factor == null) continue;
      const store = pickValue(row, MARKUP_QUE.storeName) ?? "";
      const productCode = pickValue(row, MARKUP_QUE.productCode) ?? "";
      if (!store || !productCode) continue;

      byStoreProduct.set(`${normalizeStoreName(store)}|${productCode}`, factor);
      byLooseStoreProduct.set(`${looseStoreName(store)}|${productCode}`, factor);
    }
    return { byStoreProduct, byLooseStoreProduct };
  });
}

/** 取某门店 + 某商品的加价系数（取不到返回 null） */
export async function getMarkupFactor(storeName: string, productCode: string): Promise<number | null> {
  const index = await getMarkupIndex();
  const key = `${normalizeStoreName(storeName)}|${productCode}`;
  const hit = index.byStoreProduct.get(key);
  if (hit != null) return hit;
  const looseHit = index.byLooseStoreProduct.get(`${looseStoreName(storeName)}|${productCode}`);
  return looseHit ?? null;
}

/* ---------------- 报价（服务端计算，含成本字段，仅供管理侧按需使用） ---------------- */

export type PricedItemResult = {
  item: CatalogItem;
  qty: number;
  markupFactor: number | null;
  storeFactor: number | null;
  factor: number | null;
  factorSource: "markup" | "store" | "missing";
  customerUnitPrice: number | null;
  customerAmount: number | null;
};

/** 计算单个商品的客户价（缺系数时返回 factorSource=missing，调用方需提示） */
export async function priceItem(params: {
  storeName: string;
  productCode: string;
  qty: number;
}): Promise<PricedItemResult | null> {
  const item = await getCatalogItem(params.productCode);
  if (!item) return null;

  const [storePricing, markupFactor] = await Promise.all([
    getStorePricing(params.storeName),
    getMarkupFactor(params.storeName, params.productCode),
  ]);

  const factor = markupFactor ?? storePricing.factor;
  const factorSource: PricedItemResult["factorSource"] =
    markupFactor != null ? "markup" : storePricing.factor != null ? "store" : "missing";

  const qty = Number.isFinite(params.qty) ? params.qty : 0;
  const unitPrice = factor == null ? null : round4(item.purchasePrice * factor);
  const amount = unitPrice == null ? null : round4(unitPrice * qty);

  return {
    item,
    qty,
    markupFactor,
    storeFactor: storePricing.factor,
    factor,
    factorSource,
    customerUnitPrice: unitPrice,
    customerAmount: amount,
  };
}

/** 子表行内取货（用于回读轻流单据时兜底） */
export function readItemCells(cells: ReturnType<typeof pickTableRows>[number]) {
  return {
    productCode: pickCellValue(cells, 462541085) ?? "",
    productName: pickCellValue(cells, 462541086) ?? "",
    spec: pickCellValue(cells, 462541087) ?? "",
    baseUnit: pickCellValue(cells, 462541133) ?? "",
  };
}
