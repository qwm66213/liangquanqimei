/** Qingflow queIds used by the store ledger app (f9jfn05ah801). */
export const STORE_QUE = {
  productName: 463360414,
  productCode: 463360535,
  warehouse: 463360425,
  storeName: 463454734,
  nature: 463360423,
  date: 463360429,
  inbound: 463360596,
  outbound: 463360597,
  closing: 463360598,
  opening: 463360599,
  applyTime: 2,
  applyNum: 0,
  remarks: 464005179,
  deliveryType: 464636881,
} as const;

export type StoreQueKey = keyof typeof STORE_QUE;
