/**
 * 轻流用户 ↔ 客户 的绑定关系（首次验证通过后写入，之后免验证）。
 *
 * 存储：PURCHASE_DATA_DIR（默认 <项目根>/data）下的 purchase-bindings.json
 * 生产部署需把该目录挂载为持久卷。
 */

import fs from "node:fs/promises";
import path from "node:path";

const FILE_NAME = "purchase-bindings.json";

export type IdentityBinding = {
  qfUserId: string;
  /** 内部白名单账号为 admin（可见全量），客户为 customer（仅本门店） */
  role: "admin" | "customer";
  /** 客户票据绑定的门店（admin 为空） */
  storeName?: string;
  customerLabel?: string | null;
  displayName?: string;
  mobileMask?: string;
  boundAt: string;
  expiresAt: string;
};

type DbShape = {
  version: 1;
  bindings: Record<string, IdentityBinding>;
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
    if (!parsed || typeof parsed !== "object" || !parsed.bindings) {
      return { version: 1, bindings: {} };
    }
    return parsed;
  } catch {
    return { version: 1, bindings: {} };
  }
}

async function writeDb(db: DbShape): Promise<void> {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${FILE_NAME}.${process.pid}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, filePath());
}

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

/** 读取绑定（已过期视为不存在） */
export async function getBinding(qfUserId: string): Promise<IdentityBinding | null> {
  const id = String(qfUserId ?? "").trim();
  if (!id) return null;
  const db = await readDb();
  const binding = db.bindings[id];
  if (!binding) return null;
  if (binding.expiresAt && new Date(binding.expiresAt).getTime() < Date.now()) return null;
  return binding;
}

export async function saveBinding(binding: IdentityBinding): Promise<IdentityBinding> {
  return withWriteLock(async () => {
    const db = await readDb();
    db.bindings[binding.qfUserId] = binding;
    await writeDb(db);
    return binding;
  });
}

export async function removeBinding(qfUserId: string): Promise<void> {
  await withWriteLock(async () => {
    const db = await readDb();
    delete db.bindings[qfUserId];
    await writeDb(db);
  });
}

export function bindingTtlMs(): number {
  const days = Number(process.env.PURCHASE_BINDING_DAYS ?? "90");
  const safeDays = Number.isFinite(days) && days > 0 ? days : 90;
  return safeDays * 24 * 60 * 60 * 1000;
}
