/** 二开页面接口的公共响应工具 */

import { NextResponse } from "next/server";

/** 越权/角色不符：统一按“不存在”返回，避免确认资源是否存在 */
export function permissionDenied() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export function badRequest(code: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: code, ...(extra ?? {}) }, { status: 400 });
}

export function okJson<T extends Record<string, unknown>>(payload: T) {
  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** 简易限流（单实例内存令牌桶） */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}
