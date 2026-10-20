import { META_QUE } from "./product-meta-fields";

type QingflowValue = {
  value?: string | null;
  dataValue?: string | null;
};

type QingflowAnswer = {
  queId: number;
  values?: QingflowValue[];
};

type QingflowApply = {
  applyId: string | number;
  answers?: QingflowAnswer[];
};

type FilterResult = {
  errCode: number;
  errMsg: string | null;
  result: {
    pageAmount: number;
    pageNum: number;
    pageSize: number;
    resultAmount: number;
    result: QingflowApply[];
  } | null;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function pickValue(answers: QingflowAnswer[] | undefined, queId: number): string | null {
  const answer = answers?.find((item) => item.queId === queId);
  const first = answer?.values?.[0];
  if (!first) return null;
  const raw = first.value ?? first.dataValue;
  if (raw == null) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

function toNumber(raw: string | null): number {
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export type ProductMetaItem = {
  code: string;          // 物料编号（匹配键）
  name: string;          // 商品名称
  cat: string;           // 二级分类
  spec: string;          // 规格/型号
  unit: string;          // 基本单位
  price: number;         // 进货单价(元)
  conv: number;          // 换算数1
};

export async function fetchAllProductMeta(): Promise<ProductMetaItem[]> {
  const appKey = env("QINGFLOW_PRODUCT_META_APP_KEY");
  const accessToken = env("QINGFLOW_ACCESS_TOKEN");
  const baseUrl = process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";

  const pageSize = 100;
  let pageNum = 1;
  let pageAmount = 1;
  const items: ProductMetaItem[] = [];

  while (pageNum <= pageAmount) {
    const response = await fetch(`${baseUrl}/app/${appKey}/apply/filter`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        accessToken,
      },
      body: JSON.stringify({
        pageSize,
        pageNum,
        type: 8,
        sorts: [{ queId: String(META_QUE.materialCode), isAscend: true }],
        queriesRel: "and",
        queries: [],
      }),
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`Qingflow HTTP ${response.status}`);

    const data = (await response.json()) as FilterResult;
    if (data.errCode !== 0 || !data.result) {
      throw new Error(data.errMsg || `Qingflow errCode ${data.errCode}`);
    }

    pageAmount = data.result.pageAmount || 1;
    for (const apply of data.result.result) {
      const answers = apply.answers ?? [];
      const code = pickValue(answers, META_QUE.materialCode);
      if (!code) continue;

      items.push({
        code,
        name: pickValue(answers, META_QUE.productName) ?? "",
        cat: pickValue(answers, META_QUE.catL2) ?? "",
        spec: pickValue(answers, META_QUE.spec) ?? "",
        unit: pickValue(answers, META_QUE.baseUnit) ?? "",
        price: toNumber(pickValue(answers, META_QUE.purchasePrice)),
        conv: toNumber(pickValue(answers, META_QUE.conv1)) || 1,
      });
    }
    pageNum += 1;
  }

  return items;
}
