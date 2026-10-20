import { NextRequest, NextResponse } from "next/server";
import { readTicket } from "@/lib/purchase-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/purchase/whoami —— 身份自检。
 * 无有效身份一律 401：无身份不得查看本页面（无演示/兜底模式）。
 */
export async function GET(request: NextRequest) {
  const ticket = readTicket(request);
  if (!ticket) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({
    role: ticket.role,
    storeName: ticket.role === "customer" ? ticket.storeName ?? "" : null,
    expiresAt: new Date(ticket.exp).toISOString(),
  });
}
