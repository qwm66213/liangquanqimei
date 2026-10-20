/**
 * 二开页面的类型定义。
 *
 * 关键约束：客户侧（CUSTOMER）与 管理侧（ADMIN）的出参类型完全分离，
 * 客户侧类型里不存在任何成本类字段，编译期即阻断误下发。
 */

/* ---------------- 基础取数 ---------------- */

/** 可售商品（物料信息过滤后） */
export type CatalogItem = {
  productCode: string; // 商品编号（物料编号）
  productName: string; // 商品名称
  spec: string; // 规格型号
  baseUnit: string; // 基本单位
  baseUnitCode: string;
  /** 内部用：进货单价，仅服务端算价使用，客户侧接口不下发 */
  purchasePrice: number;
};

/** 仓库下拉项 */
export type WarehouseOption = {
  name: string;
  code: string;
};

/** 门店定价上下文（服务端内部使用，不下发客户侧） */
export type StorePricing = {
  storeName: string;
  factor: number | null; // 加盟商采购系数
  factorSource: "found" | "missing" | "invalid";
  recordId?: string;
  /** 客户端基础信息·客户（单选 462541156）：页面「客户」与单据「客户」字段 */
  customerLabel?: string | null;
  /** 客户端基础信息·客户名称（文本 462540980）：页面「客户名称」与单据「客户名称」字段 */
  customerName?: string | null;
  /** 命中方式：手机号优先，姓名兜底 */
  matchedBy?: "phone" | "name";
};

/* ---------------- 客户侧 ---------------- */

/** 客户侧商品行（可含价格） */
export type CustomerQuoteLine = {
  productCode: string;
  productName: string;
  spec: string;
  baseUnit: string;
  qty: number;
  customerUnitPrice: number; // 4 位小数
  customerAmount: number; // 4 位小数
};

/** 客户侧单据 */
export type CustomerOrder = {
  orderNo: string;
  status: string; // 客户口径状态文案
  applyTime: string;
  deliveryDate: string;
  expectedArrival: string;
  warehouseName: string;
  storeName: string;
  remark: string;
  lines: CustomerQuoteLine[];
  totalQty: number;
  totalAmount: number;
};

/** 客户侧列表项 */
export type CustomerOrderSummary = {
  orderNo: string;
  status: string;
  applyTime: string;
  totalQty: number;
  totalAmount: number;
  storeName: string;
};

/* ---------------- 管理侧 ---------------- */

/** 管理侧商品行（含全部成本字段） */
export type AdminOrderLine = {
  productCode: string;
  productName: string;
  spec: string;
  baseUnit: string;
  baseUnitCode: string;
  qty: number;
  purchasePrice: number; // 进货单价
  priceFactor: number | null; // 价格系数
  markupFactor: number | null; // 商品加价系数
  taxRate: number | null;
  priceNoTax: number | null;
  priceWithTax: number | null;
  amountNoTax: number | null;
  shipAmount: number | null;
  customerUnitPrice: number;
  customerAmount: number;
};

/** 管理侧单据 */
export type AdminOrder = {
  applyId: string;
  orderNo: string;
  status: string;
  applyTime: string;
  updateTime: string;
  storeName: string;
  /** 客户名称（单据「客户」单选值，与客户端基础信息·客户名称同源）——客户侧行级归属键 */
  customerLabel: string;
  customerName: string;
  storeCode: string;
  warehouseName: string;
  warehouseCode: string;
  warehouseKeeper: string;
  deliveryDate: string;
  expectedArrival: string;
  remark: string;
  totalQty: number;
  totalInternalAmount: number;
  totalCustomerAmount: number;
  lines: AdminOrderLine[];
};

/** 管理侧列表项 */
export type AdminOrderSummary = {
  applyId: string;
  orderNo: string;
  status: string;
  storeName: string;
  customerName: string;
  applyTime: string;
  deliveryDate: string;
  totalQty: number;
  totalCustomerAmount: number;
  /** 二开侧审批状态 */
  approvalStage: ApprovalStage;
  approvalStageText: string;
};

/* ---------------- 审批状态机（二开侧） ---------------- */

export type ApprovalStage =
  | "submitted" // 待财务审批
  | "finance_approved" // 财务已通过，待总部审批
  | "hq_approved" // 总部已通过，待出库
  | "shipping" // 已发起顺丰出库
  | "shipped" // 顺丰已受理/已出库
  | "rejected" // 被驳回
  | "history"; // 二开侧无审批记录的历史单据（状态跟随轻流）

export type ApprovalAction = "finance_pass" | "finance_reject" | "hq_pass" | "hq_reject";

export type ApprovalLog = {
  at: string;
  actor: string;
  action: ApprovalAction;
  remark?: string;
  changes?: { field: string; from: string; to: string }[];
};

/** 二开侧保存的单据扩展信息（不存在轻流里） */
export type OrderApprovalState = {
  applyId: string;
  orderNo: string;
  storeName: string;
  stage: ApprovalStage;
  createdAt: string;
  updatedAt: string;
  /** 提交时的价格快照（含成本字段，仅管理侧可见） */
  lines?: AdminOrderLine[];
  /** 管理侧改价覆盖：商品编号 → 覆盖后的客户采购单价 */
  priceOverrides?: Record<string, number>;
  logs: ApprovalLog[];
  /** 顺丰出库请求体（留桩，便于接口就绪后直接对接） */
  shippingRequest?: Record<string, unknown>;
  shippingResponse?: string;
  shippedAt?: string;
};

/* ---------------- 角色 ---------------- */

export type PortalRole = "admin" | "customer";

export type PortalTicket = {
  role: PortalRole;
  /** 客户票据绑定门店名称（用于算价与展示）；管理票据为空 */
  storeName?: string;
  /** 客户票据绑定客户名称：与单据「客户」单选值同源，用于行级归属过滤 */
  customerLabel?: string;
  exp: number;
};
