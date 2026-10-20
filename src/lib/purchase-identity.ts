/**
 * 客户身份识别（轻流门户 → 二开侧）。
 *
 * 链路：
 *   轻流在 iframe 地址上自动追加 qfExtUserId / qfWsId / qfTimestamp
 *   → 服务端用 GET /user/{qfExtUserId} 换到「姓名 + 手机号」
 *   → 用手机号匹配「客户端基础信息·负责人电话」，兜底用姓名匹配「客户名称 / 负责人姓名」
 *   → 命中即确定该客户的门店与采购系数
 *
 * 说明：轻流侧参数为明文、无签名，因此识别结果必须由服务端会话固化，
 * 并在首次使用时做一次"手机号后 6 位"确认（见 api/purchase/session）。
 */

import { CLIENT_APP_KEY, CLIENT_QUE } from "./purchase-fields";
import { filterAllRows, pickValue, type QfRow } from "./purchase-qingflow";
import { parseFactor } from "./purchase-pricing";
import type { StorePricing } from "./purchase-types";

function baseUrl(): string {
  return process.env.QINGFLOW_BASE_URL ?? "https://api.qingflow.com";
}

function accessToken(): string {
  const token = process.env.QINGFLOW_ACCESS_TOKEN;
  if (!token) throw new Error("Missing env: QINGFLOW_ACCESS_TOKEN");
  return token;
}

export type QingflowUser = {
  userId: string;
  name: string;
  mobileNum: string;
  department: string[];
  role: string[];
};

/** 手机号归一化：只留数字（兼容 +86 / 空格 / 横线） */
export function normalizeMobile(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length > 11) return digits.slice(-11);
  return digits;
}

/** 手机号掩码：135****2295 */
export function maskMobile(mobile: string): string {
  const m = normalizeMobile(mobile);
  if (m.length < 7) return "";
  return `${m.slice(0, 3)}****${m.slice(-4)}`;
}

/** 调轻流开放 API 读取用户信息 */
export async function fetchQingflowUser(userId: string): Promise<QingflowUser | null> {
  const id = String(userId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;

  const res = await fetch(`${baseUrl()}/user/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json", accessToken: accessToken() },
    cache: "no-store",
  });
  const text = await res.text();
  let json: {
    errCode?: number;
    result?: { userId?: string | number; name?: string; mobileNum?: string; department?: unknown[]; role?: unknown[] } | null;
  };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
  if (json.errCode !== 0 || !json.result) return null;

  return {
    userId: String(json.result.userId ?? id),
    name: String(json.result.name ?? "").trim(),
    mobileNum: String(json.result.mobileNum ?? "").trim(),
    department: (json.result.department ?? []).map(String),
    role: (json.result.role ?? []).map(String),
  };
}

/**
 * 用「手机号（优先）→ 姓名（兜底）」在客户端基础信息里定位客户。
 * 未命中返回 null（调用方必须拒绝访问，不得放行）。
 */
export async function resolveCustomerByIdentity(input: {
  mobile?: string | null;
  name?: string | null;
}): Promise<StorePricing | null> {
  const rows = await filterAllRows(CLIENT_APP_KEY, { pageSize: 200 });

  const mobile = normalizeMobile(input.mobile);
  if (mobile) {
    for (const row of rows) {
      const phone = normalizeMobile(pickValue(row, CLIENT_QUE.ownerPhone));
      if (phone && phone === mobile) return toPricing(row, "phone");
    }
  }

  const name = String(input.name ?? "").trim();
  if (name) {
    for (const row of rows) {
      if ((pickValue(row, CLIENT_QUE.customerName) ?? "").trim() === name) return toPricing(row, "name");
    }
    for (const row of rows) {
      if ((pickValue(row, CLIENT_QUE.ownerName) ?? "").trim() === name) return toPricing(row, "name");
    }
  }

  return null;
}

/** 解析逗号/空格分隔的 ID 列表 */
export function parseIdSet(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * 内部白名单判定：用户 ID 或角色 ID 命中即视为内部账号（可见全量数据）。
 * 配置：
 *   PURCHASE_ALLOWED_USER_IDS  逗号分隔的用户 ID，例如 860116
 *   PURCHASE_ALLOWED_ROLE_IDS  逗号分隔的角色 ID
 */
export function isInternalAllowed(user: QingflowUser): boolean {
  const userIds = parseIdSet(process.env.PURCHASE_ALLOWED_USER_IDS ?? "860116,2892285");
  if (userIds.has(user.userId)) return true;
  const roleIds = parseIdSet(process.env.PURCHASE_ALLOWED_ROLE_IDS);
  if (roleIds.size === 0) return false;
  return user.role.some((role) => roleIds.has(role));
}

function toPricing(row: QfRow, matchedBy: "phone" | "name"): StorePricing {
  const factor = parseFactor(pickValue(row, CLIENT_QUE.factor));
  return {
    storeName: pickValue(row, CLIENT_QUE.storeName) ?? "",
    factor,
    factorSource: factor == null ? "invalid" : "found",
    recordId: String(row.applyId),
    customerLabel: pickValue(row, CLIENT_QUE.customer) ?? null,
    customerName: pickValue(row, CLIENT_QUE.customerName) ?? null,
    matchedBy,
  };
}
