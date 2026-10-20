/**
 * 顺丰仓出库对接（留桩）。
 *
 * 总部审批通过后调用；接口地址与鉴权通过环境变量配置：
 *   PURCHASE_SF_SHIPPING_URL  顺丰出库接口地址（未配置时只记录待发请求，不发起调用）
 *   PURCHASE_SF_SHIPPING_TOKEN 鉴权 token（可选）
 *
 * 未配置时：单据状态停在「待出库」，请求体保存在二开侧存储中，接口就绪后可直接对接。
 */

export type ShippingRequestLine = {
  productCode: string;
  productName: string;
  spec: string;
  unit: string;
  qty: number;
};

export type ShippingRequestInput = {
  orderNo: string;
  storeName: string;
  warehouseName: string;
  warehouseCode: string;
  deliveryDate: string;
  expectedArrival: string;
  contact?: string;
  phone?: string;
  address?: string;
  lines: ShippingRequestLine[];
};

/** 构造顺丰出库请求体（字段名待接口文档确认后可调整此函数，不影响其他逻辑） */
export function buildShippingRequest(input: ShippingRequestInput): Record<string, unknown> {
  return {
    orderNo: input.orderNo,
    warehouse: {
      name: input.warehouseName,
      code: input.warehouseCode,
    },
    receiver: {
      storeName: input.storeName,
      contact: input.contact ?? "",
      phone: input.phone ?? "",
      address: input.address ?? "",
    },
    deliveryDate: input.deliveryDate,
    expectedArrival: input.expectedArrival,
    items: input.lines.map((line) => ({
      itemCode: line.productCode,
      itemName: line.productName,
      spec: line.spec,
      unit: line.unit,
      qty: line.qty,
    })),
  };
}

export type ShippingDispatchResult = {
  configured: boolean;
  ok: boolean;
  message: string;
  response?: string;
};

/** 发起出库请求；未配置接口时返回 configured=false，由调用方保留「待出库」状态 */
export async function dispatchShipping(payload: Record<string, unknown>): Promise<ShippingDispatchResult> {
  const url = process.env.PURCHASE_SF_SHIPPING_URL;
  if (!url || url.trim() === "") {
    return {
      configured: false,
      ok: false,
      message: "顺丰出库接口未配置（PURCHASE_SF_SHIPPING_URL），已记录待发请求",
    };
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = process.env.PURCHASE_SF_SHIPPING_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await response.text();
    return {
      configured: true,
      ok: response.ok,
      message: response.ok ? "顺丰出库请求已发出" : `顺丰接口返回 HTTP ${response.status}`,
      response: text.slice(0, 1000),
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      message: `顺丰接口调用异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
