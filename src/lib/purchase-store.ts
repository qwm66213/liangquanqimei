/**
 * 二开侧单据状态存储（审批状态、审批日志、价格覆盖、顺丰请求体）。
 *
 * 存储位置：PURCHASE_DATA_DIR（默认 <项目根>/data）下的 purchase-orders.json。
 * 生产部署需把该目录挂载为持久卷，否则容器重建会丢失审批状态。
 * 单实例部署，写入串行化，避免并发覆盖。
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ApprovalLog, OrderApprovalState } from "./purchase-types";

const FILE_NAME = "purchase-orders.json";

type DbShape = {
  version: 1;
  orders: Record<string, OrderApprovalState>;
};

function dataDir(): string {
  return process.env.PURCHASE_DATA_DIR ?? path.join(process.cwd(), "data");
}

function filePath(): string {
  return path.join(dataDir(), FILE_NAME);
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readDb(): Promise<DbShape> {
  try {
    const text = await fs.readFile(filePath(), "utf8");
    const parsed = JSON.parse(text) as DbShape;
    if (!parsed || typeof parsed !== "object" || !parsed.orders) {
      return { version: 1, orders: {} };
    }
    return parsed;
  } catch {
    return { version: 1, orders: {} };
  }
}

async function writeDb(db: DbShape): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${FILE_NAME}.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, filePath());
}

/** 串行执行写操作 */
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

export async function getOrderState(applyId: string): Promise<OrderApprovalState | null> {
  const db = await readDb();
  return db.orders[applyId] ?? null;
}

export async function listOrderStates(): Promise<OrderApprovalState[]> {
  const db = await readDb();
  return Object.values(db.orders);
}

export async function saveOrderState(state: OrderApprovalState): Promise<OrderApprovalState> {
  return withWriteLock(async () => {
    const db = await readDb();
    db.orders[state.applyId] = { ...state, updatedAt: new Date().toISOString() };
    await writeDb(db);
    return db.orders[state.applyId];
  });
}

export async function updateOrderState(
  applyId: string,
  patch: (current: OrderApprovalState) => OrderApprovalState,
): Promise<OrderApprovalState | null> {
  return withWriteLock(async () => {
    const db = await readDb();
    const current = db.orders[applyId];
    if (!current) return null;
    const next = patch(current);
    db.orders[applyId] = { ...next, updatedAt: new Date().toISOString() };
    await writeDb(db);
    return db.orders[applyId];
  });
}

export async function appendApprovalLog(applyId: string, log: ApprovalLog): Promise<void> {
  await updateOrderState(applyId, (current) => ({
    ...current,
    logs: [...(current.logs ?? []), log],
  }));
}
