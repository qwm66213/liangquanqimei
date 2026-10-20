/**
 * 门户票据（角色鉴权）。
 *
 * 角色写在签名里，前端改 URL 参数无效：
 *   token = base64url(payload) + "." + HMAC-SHA256(payload, SECRET)
 *   payload = { role, storeName?, exp }
 *
 * 环境变量：
 *   PURCHASE_PORTAL_SECRET  必填（生产）。未配置时使用进程内随机密钥并告警（仅便于本地调试）。
 */

import crypto from "node:crypto";
import type { PortalRole, PortalTicket } from "./purchase-types";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

let ephemeralSecret: string | null = null;

function secret(): string {
  const configured = process.env.PURCHASE_PORTAL_SECRET;
  if (configured && configured.trim() !== "") return configured;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[purchase-auth] 未配置 PURCHASE_PORTAL_SECRET，已生成进程内临时密钥（重启后票据失效，请在生产环境配置）",
    );
  }
  return ephemeralSecret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** 生成票据 */
export function issueTicket(
  input: { role: PortalRole; storeName?: string; customerLabel?: string; ttlMs?: number },
): string {
  const exp = Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS);
  const payload: PortalTicket = {
    role: input.role,
    storeName: input.storeName,
    customerLabel: input.customerLabel,
    exp,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** 校验票据（签名 + 有效期） */
export function verifyTicket(token: string | null | undefined): PortalTicket | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PortalTicket;
    if (!payload || (payload.role !== "admin" && payload.role !== "customer")) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    if (payload.role === "customer" && !payload.storeName && !payload.customerLabel) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 从请求中读取票据：请求头优先，其次 URL 参数 */
export function readTicket(request: Request): PortalTicket | null {
  const header = request.headers.get("x-portal-token");
  if (header) return verifyTicket(header.trim());
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("t");
    return verifyTicket(query);
  } catch {
    return null;
  }
}

/** 未授权响应体（统一文案，不含内部信息） */
export const UNAUTHORIZED_BODY = { error: "unauthorized" } as const;
export const FORBIDDEN_BODY = { error: "not_found" } as const;

/**
 * 客户票据的「行级归属键」：客户名称优先（与单据「客户」单选同源），门店名称兜底。
 * 算价仍使用 ticket.storeName（客户端基础信息·门店名称）。
 */
export function ticketCustomerKey(ticket: PortalTicket): string {
  return (ticket.customerLabel ?? ticket.storeName ?? "").trim();
}

/* ---------------- 手机号自助入口（外部客户） ---------------- */

/**
 * 手机号自助验证的「一次性挑战」。
 * 与门户票据共用同一密钥，但用 kind 区分类型，两者不可互换：
 *   - 挑战缺 role，无法通过 verifyTicket；
 *   - 票据缺 kind，无法通过 verifyMobileChallenge。
 */
export type MobileChallenge = {
  kind: "mobile";
  mobile: string;
  storeName: string;
  customerLabel?: string;
  exp: number;
};

export const MOBILE_CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 分钟

export function issueMobileChallenge(input: {
  mobile: string;
  storeName: string;
  customerLabel?: string;
  ttlMs?: number;
}): string {
  const payload: MobileChallenge = {
    kind: "mobile",
    mobile: input.mobile,
    storeName: input.storeName,
    customerLabel: input.customerLabel,
    exp: Date.now() + (input.ttlMs ?? MOBILE_CHALLENGE_TTL_MS),
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyMobileChallenge(token: string | null | undefined): MobileChallenge | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MobileChallenge;
    if (!payload || payload.kind !== "mobile") return null;
    if (!payload.mobile || !payload.storeName) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
