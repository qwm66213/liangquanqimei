/**
 * 生成二开页面入口票据（管理员本地使用）。
 *
 * 用法：
 *   npx --yes tsx scripts/issue-ticket.ts admin [有效期天数]
 *   npx --yes tsx scripts/issue-ticket.ts customer "<客户名称>" [有效期天数]
 *
 * 说明：
 *  - 客户票据按「客户名称」生成：脚本会到客户端基础信息里查出该客户的门店名称与采购系数，
 *    票据里同时带上 customerLabel（行级归属键）与 storeName（算价用门店名）。
 *  - 票据通过 PURCHASE_PORTAL_SECRET 签名，必须与服务端运行环境一致。
 *  - 客户专属链接形如：https://<域名>/purchase.html?t=<票据>
 *    （配置到轻流门户的网页组件地址里即可，不依赖门户传参）
 */

import fs from "node:fs";
import { issueTicket } from "../src/lib/purchase-auth";
import { resolveCustomerByIdentity } from "../src/lib/purchase-identity";

function loadEnv(file: string) {
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    /* ignore */
  }
}

function publicBase(): string {
  return (process.env.PURCHASE_PUBLIC_BASE_URL ?? "https://liangquan.brianyuan.dpdns.org").replace(/\/+$/, "");
}

async function main() {
  loadEnv(".env.local");
  loadEnv(".env");

  const role = (process.argv[2] ?? "").trim();
  if (role !== "admin" && role !== "customer") {
    console.error('用法: tsx scripts/issue-ticket.ts <admin|customer> ["客户名称"] [有效期天数]');
    process.exit(1);
  }

  const days = Number(process.argv[role === "customer" ? 4 : 3] ?? 30);
  const ttlDays = Number.isFinite(days) && days > 0 ? days : 30;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;

  if (role === "admin") {
    const token = issueTicket({ role: "admin", ttlMs });
    console.log("角色: admin（内部视图：全量只读 + 导出）");
    console.log(`有效期: ${ttlDays} 天`);
    console.log(`页面地址: ${publicBase()}/purchase.html?t=${token}`);
    return;
  }

  const customerLabel = (process.argv[3] ?? "").trim();
  if (!customerLabel) {
    console.error('客户票据必须提供客户名称，例如: tsx scripts/issue-ticket.ts customer "粮全其美国展"');
    process.exit(1);
  }

  const customer = await resolveCustomerByIdentity({ name: customerLabel });
  if (!customer || !customer.storeName) {
    console.error(`未在「客户端基础信息」中找到客户：${customerLabel}（请核对客户名称/负责人姓名）`);
    process.exit(1);
  }

  const token = issueTicket({
    role: "customer",
    storeName: customer.storeName,
    customerLabel: customer.customerLabel ?? customerLabel,
    ttlMs,
  });

  console.log(`客户: ${customer.customerLabel ?? customerLabel}（匹配方式：${customer.matchedBy ?? "-"}）`);
  console.log(`门店: ${customer.storeName}`);
  console.log(`采购系数: ${customer.factor ?? "（未配置，提交时会报缺系数）"}`);
  console.log(`有效期: ${ttlDays} 天`);
  console.log(`页面地址: ${publicBase()}/purchase.html?t=${token}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
