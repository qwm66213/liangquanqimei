/**
 * 顺丰 BPS 入库报文 → 轻流 openAPI answers 解析器（二开替代 Q-Source）
 *
 * 核心规则（来自线上验证结论）：
 * 1. 数字字段必须转整数/去除浮点尾数（浮点 4.00000000 → 4，否则轻流报 40502）
 * 2. 文本字段 values 只传 {"value": "xxx"}，不传 otherInfo/id 空串（否则值被丢弃）
 * 3. 子表单「入库明细」按 batchItems 逐行提取，每行生成一个 tableValues 行；
 *    同一商品若生产日期不同会拆成多行，保留多行不合并（入库数量不累加）
 *
 * 目标应用：主流程应用 e04doio3ps02（无参调用默认使用该应用的字段配置）。
 * 原测试应用 fgaeqpu8go02 已停用，相关字段配置代码注释保留（见文件下方）。
 */

import { BPS_FIELDS_E04 } from "./bps-config-e04doio3ps02";

export type BpsBatchItem = Record<string, unknown> & {
  itemCode?: string;
  itemName?: string;
  actualQty?: number | string;
  planQty?: number | string;
  spec?: string;
  unitName?: string;
  stockUnitName?: string;
  prdDate?: string; // 生产日期 (YYYY-MM-DD)
  expDate?: string; // 到期时间 (YYYY-MM-DD)
};

export type BpsMessage = Record<string, unknown> & {
  id?: string;
  type?: string;
  ata?: number;
  updateTime?: number;
  customerNo?: string;
  dcCode?: string;
  bizType?: string;
  systemSource?: string;
  batchItems?: BpsBatchItem[];
  items?: Record<string, unknown>[];
  fromLocNode?: { code?: string; name?: string };
  toLocNode?: { name?: string };
  custPurchaseOrder?: Record<string, unknown>;
};

/**
 * 历史入库单据的商品明细行（整单累计判定用）。
 * 数据源：轻流应用里按采购单号(poNo)查到的历史单据，
 *   优先子表单「入库明细」（含 itemCode），回退备注文本解析（只有商品名）。
 */
export type InboundHistoryRow = {
  /** 商品数据编号；备注文本解析出的历史行可能为空（仅有商品名） */
  itemCode: string;
  /** 商品名称 */
  itemName: string;
  /** 该单据的计划数量（仅用于追溯；累计判定只取 actualQty） */
  planQty: number;
  /** 该单据实际入库数量（需叠加进整单累计实收） */
  actualQty: number;
};

/**
 * 【已停用】原测试应用 fgaeqpu8go02 的主表字段 ID。
 * 该应用已停止使用，代码注释保留（不删除）。
 * 当前唯一在用应用为主流程应用 e04doio3ps02（配置见 ./bps-config-e04doio3ps02.ts）。
 */
// export const INBOUND_QUE = {
//   purchaseDate: 467272341, // 采购日期 (日期)；注：467272316「入库日期」为公式计算字段，不解析写入
//   poNo: 467272339, // 采购订单数据编号 (文本)
//   inboundType: 467272537, // 入库类型 (下拉，值=选项名称)
//   warehouse: 467272336, // 选入仓库 (关联，值=仓库名称)
//   inboundTsText: 467272380, // 【系统配置】入库时期时间戳 (文本)
//   dcCode: 467272386, // 【系统配置】仓库编码 (文本)
//   type: 467272384, // type (文本)
//   interfaceEcho: 467272383, // 接口回传 (多行文本，存整个请求数据用于查重/追溯)
// } as const;

/** 【已停用】原测试应用 fgaeqpu8go02 的入库类型下拉选项：选项名称 → 选项 ID */
// export const INBOUND_TYPE_OPTIONS: Record<string, number> = {
//   采购入库: 164559037,
//   调拨入库: 164559038,
// };

/** 【已停用】原测试应用 fgaeqpu8go02 的子表单「入库明细」467272317 的子字段 ID */
// export const INBOUND_SUB_QUE = {
//   tableId: 467272317, // 子表单本身
//   itemCode: 467272368, // 商品数据编号 (文本)
//   itemName: 467272367, // 商品名称 (文本)
//   spec: 467272377, // 规格型号 (文本)
//   planQty: 467594959, // 订货数量 (数字)
//   unitName: 467272405, // 采购单位 (文本)
//   stockUnitName: 467272393, // 基本单位 (文本)
//   actualQty: 467594960, // 入库数量 (数字)
// } as const;

/** 应用字段配置：同一套解析逻辑可同步到多个轻流应用（字段 queId 不同） */
export type BpsFieldConfig = {
  que: {
    purchaseDate: number; // 采购日期 (日期)
    poNo: number; // 采购订单数据编号 (文本)
    inboundType: number; // 入库类型 (下拉，值=选项名称)
    warehouse: number; // 选入仓库 (关联，值=仓库名称)
    inboundTsText: number; // 【系统配置】入库时期时间戳 (文本)
    dcCode: number; // 【系统配置】仓库编码 (文本)
    type: number; // type (文本)
    remark: number; // 备注 (多行文本，入库状态：全部入库/部分入库+少发商品明细)
    interfaceEcho: number; // 接口回传 (多行文本，存整个请求数据用于查重/追溯)
  };
  subQue: {
    tableId: number; // 子表单本身
    itemCode: number; // 商品数据编号 (文本)
    itemName: number; // 商品名称 (文本)
    spec: number; // 规格型号 (文本)
    planQty: number; // 订货数量 (数字)
    unitName: number; // 采购单位 (文本)
    stockUnitName: number; // 基本单位 (文本)
    actualQty: number; // 入库数量 (数字)
    productionDate: number; // 生产日期 (日期)
    expireDate: number; // 到期时间 (日期)
  };
  typeOptions: Record<string, number>;
};

/**
 * 【已停用】原测试应用（fgaeqpu8go02）字段配置。
 * 该应用已停止使用，代码注释保留（不删除）。
 * 默认字段配置请使用 ./bps-config-e04doio3ps02.ts 的 BPS_FIELDS_E04。
 */
// export const DEFAULT_BPS_FIELDS: BpsFieldConfig = {
//   que: INBOUND_QUE,
//   subQue: INBOUND_SUB_QUE,
//   typeOptions: INBOUND_TYPE_OPTIONS,
// };

/** 数字字段转轻流可接受的整数（浮点 4.00000000 → 4） */
export function toQingflowNumber(value: unknown): number | string {
  if (value == null || value === "") return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  // 轻流数字字段为整数精度，避免浮点尾巴
  if (Number.isInteger(num)) return num;
  return Math.round(num * 100) / 100;
}

/** 毫秒时间戳 → YYYY-MM-DD（东八区） */
export function tsToDate(ms: unknown): string | null {
  if (ms == null || ms === "") return null;
  const num = Number(ms);
  if (!Number.isFinite(num) || num <= 0) return null;
  const d = new Date(num);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 处理已是 YYYY-MM-DD 的日期字符串，或时间戳 */
export function toDateString(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return tsToDate(value);
}

/** 接口回传快照的核心主表字段（轻流多行文本字段长度上限约 5000 字符，需压缩） */
const ECHO_CORE_KEYS = [
  "type",
  "id",
  "dcCode",
  "customerNo",
  "ata",
  "updateTime",
  "bizType",
  "systemSource",
  "fromLocCode",
  "toLocCode",
  "code",
  "refNo1",
  "refNo2",
  "asnOrderId",
  "inputSource",
] as const;

/** 快照超限时，batchItems 每行仅保留的业务核心字段 */
const BATCH_ITEM_SLIM_KEYS = [
  "itemCode",
  "itemName",
  "spec",
  "planQty",
  "actualQty",
  "unitName",
  "stockUnitName",
  "prdDate",
  "expDate",
  "pos",
  "linePos",
  "refPos",
] as const;

/** 将 batchItems 精简为仅业务核心字段（用于快照超限降级） */
function slimBatchItems(batchItems: unknown): unknown {
  if (!Array.isArray(batchItems)) return batchItems;
  return batchItems.map((b) => {
    if (typeof b !== "object" || b == null) return b;
    const out: Record<string, unknown> = {};
    for (const key of BATCH_ITEM_SLIM_KEYS) {
      const v = (b as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = v;
    }
    return out;
  });
}

/**
 * 构造接口回传快照 JSON：核心主表字段 + items + batchItems + custPurchaseOrder。
 * 轻流多行文本字段约 5000 字符上限，超限时逐级降级：
 *   1) batchItems 精简为业务核心字段
 *   2) 再去掉 custPurchaseOrder
 *   3) 再去掉 items
 *   4) 仅保留核心主表字段（兜底，必在 5000 内）
 */
export function buildEchoSnapshot(msg: BpsMessage): string {
  const core: Record<string, unknown> = {};
  for (const key of ECHO_CORE_KEYS) {
    const v = msg[key];
    if (v !== undefined) core[key] = v;
  }
  let json = JSON.stringify({
    ...core,
    items: msg.items,
    batchItems: msg.batchItems,
    custPurchaseOrder: msg.custPurchaseOrder,
  });
  if (json.length <= 5000) return json;

  // 1) batchItems 精简为业务核心字段
  json = JSON.stringify({
    ...core,
    items: msg.items,
    batchItems: slimBatchItems(msg.batchItems),
    custPurchaseOrder: msg.custPurchaseOrder,
  });
  if (json.length <= 5000) return json;

  // 2) 去掉 custPurchaseOrder
  json = JSON.stringify({
    ...core,
    items: msg.items,
    batchItems: slimBatchItems(msg.batchItems),
  });
  if (json.length <= 5000) return json;

  // 3) 去掉 items
  json = JSON.stringify({ ...core, batchItems: slimBatchItems(msg.batchItems) });
  if (json.length <= 5000) return json;

  // 4) 仅核心主表字段（兜底）
  return JSON.stringify(core);
}

/**
 * 入库状态统计：按 itemCode 聚合对比「计划 vs 累计实收」。
 * 计划数量取自 items[].planQty（每个商品一行，为全单订单计划数）；
 * items 缺失时回退 batchItems[].planQty。
 * 实收数量 = 当前报文 batchItems[].actualQty（同一商品按生产日期拆多行，累加）
 *           + 可选的历史单据 actualQty（history，同一采购单之前批次的已入库量）。
 * 少发 = 计划 - 累计实收。
 * history 仅作增强：不传时保持原有“只看当前报文”的行为。
 */
export function statInbound(
  msg: BpsMessage,
  history?: InboundHistoryRow[],
): {
  isPartial: boolean;
  shortItems: {
    itemCode: string;
    itemName: string;
    planQty: number;
    actualQty: number;
    shortQty: number;
  }[];
} {
  // 计划：items[].planQty（商品维度一行）
  const planByCode = new Map<string, { name: string; plan: number }>();
  for (const it of Array.isArray(msg.items) ? msg.items : []) {
    const code = String(it.itemCode ?? "");
    if (!code) continue;
    const plan = Number(it.planQty ?? 0) || 0;
    const cur = planByCode.get(code) ?? { name: String(it.itemName ?? code), plan: 0 };
    cur.plan += plan;
    planByCode.set(code, cur);
  }
  // 实收：batchItems[].actualQty
  const batch = Array.isArray(msg.batchItems) ? msg.batchItems : [];
  const actualByCode = new Map<string, { name: string; actual: number }>();
  for (const b of batch) {
    const code = String(b.itemCode ?? b.itemName ?? "");
    if (!code) continue;
    const actual = Number(b.actualQty ?? 0) || 0;
    const cur = actualByCode.get(code) ?? { name: String(b.itemName ?? code), actual: 0 };
    cur.actual += actual;
    actualByCode.set(code, cur);
  }
  // 报文无 items 时（异常结构），用 batchItems.planQty 兜底
  if (planByCode.size === 0) {
    for (const b of batch) {
      const code = String(b.itemCode ?? b.itemName ?? "");
      if (!code) continue;
      const plan = Number(b.planQty ?? 0) || 0;
      const cur = planByCode.get(code) ?? { name: String(b.itemName ?? code), plan: 0 };
      cur.plan += plan;
      planByCode.set(code, cur);
    }
  }
  // 历史累计：把该采购单之前批次已入库数量叠加进实收
  if (Array.isArray(history) && history.length > 0) {
    // 名称→编码：历史行仅有商品名（备注文本解析）时，尽量归一到当前报文的商品编码
    const nameToCode = new Map<string, string>();
    for (const [code, p] of planByCode) {
      if (p.name) nameToCode.set(p.name, code);
    }
    for (const b of batch) {
      const name = String(b.itemName ?? "");
      const code = String(b.itemCode ?? "");
      if (name && !nameToCode.has(name)) nameToCode.set(name, code);
    }
    for (const h of history) {
      const code =
        String(h.itemCode ?? "").trim() ||
        nameToCode.get(String(h.itemName ?? "").trim()) ||
        "";
      if (!code) continue; // 无法归一的（无编码且名称对不上）不计入，宁缺勿滥
      const actual = Number(h.actualQty ?? 0) || 0;
      const cur = actualByCode.get(code) ?? {
        name: String(h.itemName ?? code),
        actual: 0,
      };
      cur.actual += actual;
      actualByCode.set(code, cur);
    }
  }
  const fmt = (n: number): number => Math.round(n * 100) / 100;
  const codes = new Set([...planByCode.keys(), ...actualByCode.keys()]);
  const shortItems = [...codes]
    .map((code) => {
      const p = planByCode.get(code);
      const a = actualByCode.get(code);
      const plan = p?.plan ?? 0;
      const actual = a?.actual ?? 0;
      return {
        itemCode: code,
        itemName: p?.name ?? a?.name ?? code,
        planQty: fmt(plan),
        actualQty: fmt(actual),
        shortQty: fmt(plan - actual),
      };
    })
    .filter((x) => x.actualQty < x.planQty);
  return { isPartial: shortItems.length > 0, shortItems };
}

/**
 * 入库状态备注：全部入库 / 部分入库 + 少发商品统计。
 * 计划数量取自 items[].planQty，实收数量为「历史累计 + 当前报文 batchItems」。
 * 返回空串表示无商品明细（不写备注字段）。
 */
export function buildInboundRemark(
  msg: BpsMessage,
  history?: InboundHistoryRow[],
): string {
  const batch = Array.isArray(msg.batchItems) ? msg.batchItems : [];
  if (batch.length === 0) return "";
  const { shortItems } = statInbound(msg, history);
  if (shortItems.length === 0) return "全部入库";
  const lines = ["部分入库"];
  for (const s of shortItems) {
    lines.push(`${s.itemName} 计划${s.planQty} 实收${s.actualQty} 少发${s.shortQty}`);
  }
  return lines.join("\n");
}

/** 构造主表单 answers 项 */
function answer(
  queId: number,
  queType: number,
  value: unknown,
  typeOptions: Record<string, number> = {},
) {
  // 下拉(queType 10)：value 需传选项 ID（或名称），用选项 ID 最稳
  if (queType === 10) {
    const optId =
      typeof value === "number" || /^\d+$/.test(String(value ?? ""))
        ? value
        : typeOptions[String(value)];
    return { queId, queTitle: "", queType, values: [{ id: optId ?? value, value }] };
  }
  // 关联字段(queType 19)：直接传关联值（名称）
  if (queType === 19) {
    return { queId, queTitle: "", queType, values: [{ value }] };
  }
  return { queId, queTitle: "", queType, values: [{ value }] };
}

/** 主表字段：文本/数字/日期 + 可空判断 + 可选转换 */
type FieldSpec = {
  queId: number;
  queType: number;
  get: (msg: BpsMessage) => unknown;
};

/** 子表单项：与主表单项一致，另含 tableValues 行 */
export type BpsAnswer =
  | ReturnType<typeof answer>
  | {
      queId: number;
      queTitle: string;
      queType: 18;
      values: [];
      tableValues: {
        queId: number;
        queTitle: string;
        queType: number;
        values: { value: unknown }[];
      }[][];
    };

/** 解析结果 */
export type ParsedInbound = {
  /** 报文唯一标识（防重用） */
  messageId: string;
  /** 顺丰 customerNo 采购订单号 */
  poNo: string;
  /** 轻流 answers 数组 */
  answers: BpsAnswer[];
  /** 商品行数 */
  itemCount: number;
};

const EMPTY_APPLY_USER = { email: "", areaCode: "", mobile: "" };

/**
 * 主入口：把顺丰 BPS 报文解析为轻流 openAPI 的 answers。
 * 不调用任何接口，纯函数，便于单测与联调。
 */
export function parseBpsMessage(
  msg: BpsMessage,
  config: BpsFieldConfig = BPS_FIELDS_E04,
  history?: InboundHistoryRow[],
): ParsedInbound {
  const { que, subQue, typeOptions } = config;
  // batchItems 逐行解析：同一商品若生产日期不同会拆成多行，保留多行不合并（入库数量不累加）
  const batch = Array.isArray(msg.batchItems) ? msg.batchItems : [];
  const cpo = (msg.custPurchaseOrder ?? {}) as Record<string, unknown>;

  // 采购日期：来自 custPurchaseOrder.orderDate
  const purchaseDate = toDateString(cpo.orderDate);

  // 报文唯一标识：优先顺丰报文 id，回退 customerNo + ata
  const messageId = String(
    msg.id ?? `${msg.customerNo ?? ""}-${msg.ata ?? msg.updateTime ?? ""}`,
  );

  const answers: BpsAnswer[] = [];

  // 主表字段（只保留业务真实需要的字段，其余信息存接口回传）
  const fields: FieldSpec[] = [
    { queId: que.purchaseDate, queType: 4, get: () => purchaseDate },
    { queId: que.poNo, queType: 2, get: () => cpo.code ?? msg.customerNo ?? "" },
    {
      queId: que.inboundType,
      queType: 10,
      get: () => cpo.typeName ?? msg.type ?? "",
    },
    { queId: que.warehouse, queType: 19, get: () => cpo.dcName ?? "" },
    // 【系统配置】入库时期时间戳：父级 ata 原样（毫秒时间戳文本）
    {
      queId: que.inboundTsText,
      queType: 2,
      get: () => (msg.ata != null ? String(msg.ata) : ""),
    },
    { queId: que.dcCode, queType: 2, get: () => cpo.dcCode ?? msg.dcCode ?? "" },
    { queId: que.type, queType: 2, get: () => cpo.type ?? msg.type ?? "" },
    // 备注：入库状态（按累计实收判定：全部入库 / 部分入库+少发商品统计）
    { queId: que.remark, queType: 3, get: () => buildInboundRemark(msg, history) },
    // 接口回传：存压缩快照（核心主表 + 商品明细），供查重与快速查看；完整报文在服务器日志
    { queId: que.interfaceEcho, queType: 3, get: () => buildEchoSnapshot(msg) },
  ];

  for (const f of fields) {
    const v = f.get(msg);
    if (v == null || v === "") continue;
    answers.push(answer(f.queId, f.queType, v, typeOptions));
  }

  // 子表单「入库明细」：batchItems 逐行提取
  const subMap: { key: keyof BpsBatchItem; queId: number; queType: number; to?: (v: unknown) => unknown }[] = [
    { key: "itemCode", queId: subQue.itemCode, queType: 2 },
    { key: "itemName", queId: subQue.itemName, queType: 2 },
    { key: "spec", queId: subQue.spec, queType: 2 },
    {
      key: "planQty",
      queId: subQue.planQty,
      queType: 8,
      to: toQingflowNumber,
    },
    { key: "unitName", queId: subQue.unitName, queType: 2 },
    { key: "stockUnitName", queId: subQue.stockUnitName, queType: 2 },
    {
      key: "actualQty",
      queId: subQue.actualQty,
      queType: 8,
      to: toQingflowNumber,
    },
    {
      key: "prdDate",
      queId: subQue.productionDate,
      queType: 4,
      to: toDateString,
    },
    {
      key: "expDate",
      queId: subQue.expireDate,
      queType: 4,
      to: toDateString,
    },
  ];

  const tableValues: { queId: number; queTitle: string; queType: number; values: { value: unknown }[] }[][] = [];
  // 「订单数量」以 items 的计划数量为准（每商品一行），batchItems 行复用该值
  const planQtyByCode = new Map<string, number>();
  for (const it of Array.isArray(msg.items) ? msg.items : []) {
    const code = String(it.itemCode ?? "");
    const plan = Number(it.planQty);
    if (code && Number.isFinite(plan)) {
      planQtyByCode.set(code, (planQtyByCode.get(code) ?? 0) + plan);
    }
  }
  for (const b of batch) {
    const row: { queId: number; queTitle: string; queType: number; values: { value: unknown }[] }[] = [];
    for (const item of subMap) {
      // 订单数量：优先 items[].planQty，items 缺失时回退 batchItems[].planQty
      let raw = b[item.key];
      if (item.key === "planQty" && b.itemCode != null && planQtyByCode.has(String(b.itemCode))) {
        raw = planQtyByCode.get(String(b.itemCode));
      }
      if (raw == null || raw === "") continue;
      let v: unknown = raw;
      if (item.to) v = item.to(raw);
      if (v == null || v === "") continue;
      row.push({ queId: item.queId, queTitle: "", queType: item.queType, values: [{ value: v }] });
    }
    tableValues.push(row);
  }

  if (tableValues.length > 0) {
    answers.push({
      queId: subQue.tableId,
      queTitle: "",
      queType: 18,
      values: [],
      tableValues,
    });
  }

  return {
    messageId,
    poNo: (cpo.code ?? msg.customerNo ?? "") as string,
    answers,
    itemCount: batch.length,
  };
}

/** 构造 openAPI 写入请求体 */
export function buildApplyBody(
  msg: BpsMessage,
  config?: BpsFieldConfig,
  history?: InboundHistoryRow[],
) {
  const parsed = parseBpsMessage(msg, config, history);
  return {
    applyUser: EMPTY_APPLY_USER,
    answers: parsed.answers,
  };
}
