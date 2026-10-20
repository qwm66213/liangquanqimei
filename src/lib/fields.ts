/** Qingflow queIds used by the warehouse ledger app. */
export const QUE = {
  productName: 441215289,
  productCode: 441215410,
  warehouse: 441215300,
  nature: 441215298,
  date: 441215304,
  inbound: 463222751,
  outbound: 463222752,
  closing: 463222762,
  opening: 463222851,
  applyTime: 2,
  applyNum: 0,
  remarks: 463972936,
} as const;

export type QueKey = keyof typeof QUE;
