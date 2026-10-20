export type LedgerRow = {
  applyId: string;
  applyNum: string;
  productCode: string;
  productName: string;
  warehouse: string;
  storeName?: string;
  nature: string;
  date: string;
  applyTime: string;
  opening: number | null;
  closing: number | null;
  inbound: number;
  outbound: number;
  remarks?: string;
  deliveryType?: string;
};

export type LedgerDetailResponse = {
  rows: LedgerRow[];
  meta: {
    startDate: string;
    endDate: string;
    productCode: string;
    warehouse?: string;
    storeName?: string;
    productName: string;
    count: number;
  };
};

export type SummaryRow = {
  productCode: string;
  productName: string;
  warehouse: string;
  opening: number;
  closing: number;
  inbound: number;
  outbound: number;
  checks?: CheckDetail[];
};

export type CheckDetail = {
  nature: string;     // "盘盈" or "盘亏"
  quantity: number;   // adjusted quantity (positive)
  period: string;     // "7月盘点" etc.
  date: string;       // date of the check record
};

export type StoreSummaryRow = {
  productCode: string;
  productName: string;
  storeName: string;
  opening: number;
  closing: number;
  inbound: number;
  outbound: number;
  checks?: CheckDetail[];  // 盘点穿透明细
};

export type SummaryFilters = {
  startDate: string;
  endDate: string;
  warehouse?: string;
  productCode?: string;
  productName?: string;
};

export type SummaryResponse = {
  rows: SummaryRow[];
  warehouses: string[];
  meta: {
    startDate: string;
    endDate: string;
    sourceCount: number;
    groupCount: number;
  };
};

export type StoreSummaryResponse = {
  rows: StoreSummaryRow[];
  stores: string[];
  meta: {
    startDate: string;
    endDate: string;
    sourceCount: number;
    groupCount: number;
  };
};
