/**
 * 轻流应用 e04doio3ps02 的 BPS 入库字段配置
 *
 * 与主流程表单结构一一对应（同一套解析逻辑，与已停用的 fgaeqpu8go02 测试应用结构同源），
 * 仅字段 queId 不同。字段 ID 来自 2026-08-24 通过 openAPI /app/e04doio3ps02/form 拉取。
 *
 * 主表：
 *   采购日期 441215686、采购订单数据编号 441215684、入库类型 457265968、
 *   选入仓库 441215681、【系统配置】入库时期时间戳 451657525、
 *   【系统配置】仓库编码 453774590、type 453774459、备注 441215678、
 *   接口回传 453099898
 * 子表单「入库明细」441215662：
 *   商品数据编号 441215713、商品名称 441215712、规格型号 447423387、
 *   订单数量 441215666、采购单位 457241318、基本单位 454566395、入库数量 441215672、
 *   生产日期 442309635、到期时间 442309637
 */

import type { BpsFieldConfig } from "./bps-parser";

/** 应用 e04doio3ps02 主表字段 ID */
export const INBOUND_QUE_E04 = {
  purchaseDate: 441215686, // 采购日期 (日期)
  poNo: 441215684, // 采购订单数据编号 (文本)
  inboundType: 457265968, // 入库类型 (下拉，值=选项名称)
  warehouse: 441215681, // 选入仓库 (关联，值=仓库名称)
  inboundTsText: 451657525, // 【系统配置】入库时期时间戳 (文本)
  dcCode: 453774590, // 【系统配置】仓库编码 (文本)
  type: 453774459, // type (文本)
  remark: 441215678, // 备注 (多行文本，入库状态：全部入库/部分入库+少发商品明细)
  interfaceEcho: 453099898, // 接口回传 (多行文本，存整个请求数据用于查重/追溯)
} as const;

/** 子表单「入库明细」441215662 的子字段 ID */
export const INBOUND_SUB_QUE_E04 = {
  tableId: 441215662, // 子表单本身
  itemCode: 441215713, // 商品数据编号 (文本)
  itemName: 441215712, // 商品名称 (文本)
  spec: 447423387, // 规格型号 (文本)
  planQty: 441215666, // 订单数量 (数字)
  unitName: 457241318, // 采购单位 (文本)
  stockUnitName: 454566395, // 基本单位 (文本)
  actualQty: 441215672, // 入库数量 (数字)
  productionDate: 442309635, // 生产日期 (日期)
  expireDate: 442309637, // 到期时间 (日期)
} as const;

/** 入库类型下拉选项：选项名称 → 选项 ID */
export const INBOUND_TYPE_OPTIONS_E04: Record<string, number> = {
  采购入库: 160944955,
  调拨入库: 160944956,
};

/** e04doio3ps02 完整字段配置（供解析/查重/写入复用） */
export const BPS_FIELDS_E04: BpsFieldConfig = {
  que: INBOUND_QUE_E04,
  subQue: INBOUND_SUB_QUE_E04,
  typeOptions: INBOUND_TYPE_OPTIONS_E04,
};
