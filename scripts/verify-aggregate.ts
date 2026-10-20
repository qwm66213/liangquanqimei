import { aggregateSummary, resolveOpening } from "../src/lib/aggregate";
import type { LedgerRow } from "../src/lib/types";

const base = {
  applyNum: "",
  warehouse: "顺丰嘉定仓",
  nature: "",
  applyTime: "2026-07-29 18:36:46",
} as const;

const flower: LedgerRow[] = [
  {
    ...base,
    applyId: "1",
    applyNum: "数据流水-20260729-00000554",
    productCode: "S070108002",
    productName: "花枝更",
    date: "2026-07-01",
    opening: null,
    closing: 130,
    inbound: 130,
    outbound: 0,
  },
  {
    ...base,
    applyId: "2",
    applyNum: "数据流水-20260729-00000555",
    productCode: "S070108002",
    productName: "花枝更",
    date: "2026-07-05",
    opening: 130,
    closing: 127,
    inbound: 0,
    outbound: 3,
  },
  {
    ...base,
    applyId: "3",
    applyNum: "数据流水-20260729-00000556",
    productCode: "S070108002",
    productName: "花枝更",
    date: "2026-07-21",
    opening: 127,
    closing: 125,
    inbound: 0,
    outbound: 2,
  },
  {
    ...base,
    applyId: "4",
    applyNum: "数据流水-20260729-00000557",
    productCode: "S070108002",
    productName: "花枝更",
    date: "2026-07-26",
    opening: 125,
    closing: 123,
    inbound: 0,
    outbound: 2,
  },
];

const spicy: LedgerRow[] = [
  {
    ...base,
    applyId: "550971924560789506",
    applyNum: "数据流水-20260729-00000469",
    productCode: "S060202002",
    productName: "L-家乐牛油香麻辣酱2kg*3桶-餐饮",
    date: "2026-07-01",
    applyTime: "2026-07-29 18:36:03",
    opening: null,
    closing: 1,
    inbound: 1,
    outbound: 0,
  },
  {
    ...base,
    applyId: "550971926372728834",
    applyNum: "数据流水-20260729-00000470",
    productCode: "S060202002",
    productName: "L-家乐牛油香麻辣酱2kg*3桶-餐饮",
    date: "2026-07-01",
    applyTime: "2026-07-29 18:36:03",
    opening: 1,
    closing: 4,
    inbound: 3,
    outbound: 0,
  },
  {
    ...base,
    applyId: "550971928402771969",
    applyNum: "数据流水-20260729-00000471",
    productCode: "S060202002",
    productName: "L-家乐牛油香麻辣酱2kg*3桶-餐饮",
    date: "2026-07-08",
    applyTime: "2026-07-29 18:36:04",
    opening: 4,
    closing: 3,
    inbound: 0,
    outbound: 1,
  },
  {
    ...base,
    applyId: "550971930114048002",
    applyNum: "数据流水-20260729-00000472",
    productCode: "S060202002",
    productName: "L-家乐牛油香麻辣酱2kg*3桶-餐饮",
    date: "2026-07-20",
    applyTime: "2026-07-29 18:36:04",
    opening: 3,
    closing: 2,
    inbound: 0,
    outbound: 1,
  },
];

const derived = resolveOpening(flower[0]);
if (derived !== 0) {
  throw new Error(`expected opening derive 0, got ${derived}`);
}

const [flowerRow] = aggregateSummary(flower, "2026-07-01", "2026-07-30");
const flowerExpected = { opening: 0, inbound: 130, outbound: 7, closing: 123 } as const;
for (const key of Object.keys(flowerExpected) as (keyof typeof flowerExpected)[]) {
  if (flowerRow[key] !== flowerExpected[key]) {
    throw new Error(`flower fail ${key}: expected ${flowerExpected[key]}, got ${flowerRow[key]}`);
  }
}

const [spicyRow] = aggregateSummary(spicy, "2026-07-01", "2026-07-30");
const spicyExpected = { opening: 0, inbound: 4, outbound: 2, closing: 2 } as const;
for (const key of Object.keys(spicyExpected) as (keyof typeof spicyExpected)[]) {
  if (spicyRow[key] !== spicyExpected[key]) {
    throw new Error(`spicy fail ${key}: expected ${spicyExpected[key]}, got ${spicyRow[key]}`);
  }
}

console.log("aggregate ok:", { flowerRow, spicyRow });
