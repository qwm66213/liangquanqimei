/**
 * BPS 入库报文请求日志
 *
 * 轻流「接口回传」字段只有约 5000 字符上限，完整报文无法全部存入轻流。
 * 因此本模块把每次请求的完整原始报文写入服务器日志文件（JSONL），
 * 出现问题时可回溯当时的原始报文。
 *
 * 日志目录：环境变量 BPS_LOG_DIR（默认 ./logs），建议 docker 挂载 volume 持久化。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_LINE = 1_000_000; // 单条日志上限（防御异常超大报文）

function logDir(): string {
  return process.env.BPS_LOG_DIR ?? join(process.cwd(), "logs");
}

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type RequestLogEntry = {
  /** 报文唯一标识（messageId） */
  messageId: string;
  /** 采购订单号 */
  poNo: string;
  /** 处理结果标记：received / duplicated / submitted / failed */
  outcome: string;
  /** 附加信息（如 applyId、错误信息） */
  detail?: string;
  /** 完整原始请求体（未解包，保持上游原始内容） */
  raw?: unknown;
};

/**
 * 追加一条请求日志到当日文件：logs/bps-request-YYYY-MM-DD.jsonl
 * 写入失败不影响主流程，仅打印错误。
 */
export async function appendRequestLog(entry: RequestLogEntry): Promise<void> {
  try {
    const dir = logDir();
    await mkdir(dir, { recursive: true });
    const file = join(dir, `bps-request-${today()}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
      raw: entry.raw ?? null,
    });
    // 防御：超长则截断 raw（保留头部），避免日志文件被异常撑爆
    const safe =
      line.length <= MAX_LINE ? line : line.slice(0, MAX_LINE) + '"…(truncated)"';
    await appendFile(file, safe + "\n", "utf-8");
  } catch (err) {
    console.error(
      "[bps-log] append request log failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
