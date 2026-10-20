/**
 * 客户采购申请二开页面所用轻流应用与字段常量。
 *
 * 所有 queId 均通过轻流开放 API（/app/{appKey}/form、/app/{appKey}/apply/filter）实测确认。
 * 二开侧只读写数据，不依赖轻流表单内的公式与引用配置。
 */

/** 客户采购申请（主应用） */
export const PURCHASE_APP_KEY = "f80a9gcdts01";

/** 主表字段 */
export const PURCHASE_QUE = {
  applyNum: 0, // 编号
  applicant: 1, // 申请人
  applyTime: 2, // 申请时间
  updateTime: 3, // 更新时间
  status: 4, // 当前流程状态
  customerText: 476407151, // 客户（单行文本；原成员字段 462541150 已弃用）
  customerName: 462541155, // 客户名称
  priceFactor: 462541151, // 价格系数
  priceFactorInternal: 462850702, // 内部查看-价格系数
  storeCode: 468099006, // 客户编码（引用门店信息）
  storeName: 468144766, // 门店名称
  totalQty: 462541050, // 本次发货总量（Σ 采购数量）
  totalInternal: 462541051, // 内部-本次发货总额(元)
  totalCustomer: 462541177, // 客户-本次发货总额(元)（Σ 客户采购金额）
  remark: 462541052, // 备注
  attachments: 462541053, // 相关附件
  warehouse: 462541030, // 出库仓库（关联引用 → 仓库信息·仓库名称）
  warehouseCode: 462541125, // 出库仓库编码
  warehouseKeeper: 476416253, // 出库仓管（单行文本；原成员字段 462541028 已弃用）
  deliveryDate: 462541029, // 出库日期
  expectDate: 462541129, // 预计收货日期
  contact: 462541122, // 联系人
  phone: 462541123, // 电话
  address: 462541124, // 地址
  items: 462541083, // 子表：采购产品清单
} as const;

/** 子表「采购产品清单」字段 */
export const PURCHASE_ITEM_QUE = {
  rawCode: 462541084, // 商品原始编号
  productCode: 462541085, // 商品编号
  productName: 462541086, // 商品名称（关联引用）
  spec: 462541087, // 规格型号
  outUnit: 462541088, // 出库单位
  unitCode: 462541128, // 单位编码
  stock: 462541089, // 当前库存
  stockAmount: 462541100, // 当前金额
  qty: 462541097, // 采购数量 ★客户填写
  shipAmount: 462541093, // 发货金额(元)
  stockAfter: 462541094, // 出库后库存数量
  amountAfter: 462541099, // 出库后金额
  catL1: 462541101,
  catL2: 462541102,
  catL3: 462541103,
  catL4: 462541104,
  taxRate: 462541130, // 税率
  priceNoTax: 462541131, // 未税单价
  priceWithTax: 462541132, // 基本单位-含税价格
  baseUnit: 462541133, // 基本单位
  amountNoTax: 462541134, // 未税金额
  customerAmount: 462541173, // 客户采购金额 ★客户价
  customerUnitPrice: 462735485, // 客户采购单价 ★客户价
  markupFactor: 469390836, // 商品加价系数
  priceFactor: 471326973, // 价格系数
  purchasePrice: 462541092, // 进货单价(元)
} as const;

/** 物料信息 e04doicnps01 —— 商品选择源 */
export const MATERIAL_APP_KEY = "e04doicnps01";
export const MATERIAL_QUE = {
  productCode: 441214964, // 物料编号（对客户展示为「商品编号」）
  productName: 441214940, // 商品名称
  spec: 441214946, // 规格/型号
  baseUnit: 454560264, // 基本单位
  baseUnitCode: 454562121, // 基本单位编码
  purchasePrice: 441214955, // 进货单价(元)
  status: 441214977, // 状态 → "开启"
  deliveryType: 450425589, // 配货类型 → "CP"
} as const;
/** 商品筛选条件值 */
export const MATERIAL_STATUS_ON = "开启";
export const MATERIAL_DELIVERY_TYPE_CP = "CP";

/** 客户端基础信息 f808o0vtv001 —— 门店采购系数来源 */
export const CLIENT_APP_KEY = "f808o0vtv001";
export const CLIENT_QUE = {
  customer: 462541156, // 客户（单选，如「粮全其美国展」）
  customerName: 462540980, // 客户名称
  storeName: 462540991, // 门店名称
  factor: 462541005, // 加盟商采购系数
  customerStatus: 462540982, // 客户状态
  ownerName: 462540984, // 负责人姓名（姓名兜底匹配）
  ownerPhone: 462540985, // 负责人电话（手机号优先匹配）
} as const;

/** 物料加价信息 fjnh47157c01 —— 商品加价系数来源 */
export const MARKUP_APP_KEY = "fjnh47157c01";
export const MARKUP_QUE = {
  product: 469391194, // 选择商品（关联，值为记录 ID）
  customer: 469391195, // 选择客户（关联，值为记录 ID）
  productCode: 469390862, // 物料编号
  productName: 469390838, // 商品名称
  storeName: 469391196, // 门店名称（本次匹配主键）
  factor: 469391197, // 加价系数（文本）
} as const;

/** 仓库信息 e04doif7ps01 —— 出库仓库下拉来源 */
export const WAREHOUSE_APP_KEY = "e04doif7ps01";
export const WAREHOUSE_QUE = {
  name: 441215156, // 仓库名称
  code: 452890534, // 仓库编码
} as const;

/** 客户侧提交时的出库默认值 */
export const DEFAULT_WAREHOUSE_NAME = "顺丰嘉定仓";
export const DEFAULT_WAREHOUSE_CODE = "CK005";
/** 出库仓管默认值（单行文本字段，直接写名称） */
export const DEFAULT_WAREHOUSE_KEEPER = "范娅娅";
