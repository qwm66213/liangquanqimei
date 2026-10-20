/**
 * BPS 二开接入统一配置中心
 *
 * 应用角色：
 *  - e04doio3ps02：主流程应用（默认，无参调用时写入该应用）
 *  - 【已停用】fgaeqpu8go02：原测试应用，相关配置代码注释保留（不删除）
 *
 * 配置优先级：显式传参 > BPS_APPS 内置映射 > 环境变量覆盖
 * 环境变量：
 *  - QSOURCE_RECEIVE_URL_2   Q-Source 兜底转发地址（必填，不提供硬编码默认值；
 *                           缺失时解析失败将无法走 Q-Source 兜底，直接返回失败）
 *  - QINGFLOW_INBOUND_APP_KEY_2 可选，覆盖主流程应用 e04doio3ps02 的目标 appKey
 *  - QINGFLOW_INBOUND_APP_KEY   原测试应用 fgaeqpu8go02 覆盖变量（已停用）
 *  - QSOURCE_RECEIVE_URL        原测试应用 fgaeqpu8go02 覆盖变量（已停用）
 */
// 【已停用】import { DEFAULT_BPS_FIELDS } from "./bps-parser";
import { BPS_FIELDS_E04 } from "./bps-config-e04doio3ps02";
import type { BpsFieldConfig } from "./bps-parser";

export type BpsAppConfig = {
  appKey: string;
  fields: BpsFieldConfig;
  /** Q-Source 兜底转发地址；来自环境变量 QSOURCE_RECEIVE_URL_2，未配置时为 undefined */
  qsourceUrl?: string;
};

/**
 * 【已停用】原测试应用 fgaeqpu8go02（应用已停用，配置注释保留）
 */
// const TEST_APP_KEY = process.env.QINGFLOW_INBOUND_APP_KEY ?? "fgaeqpu8go02";
// const TEST_QSOURCE_URL =
//   process.env.QSOURCE_RECEIVE_URL ??
//   "https://qingflow.com/api/qsource/6379afe9-6c90-401f-84fe-4524f7fe62ca";

/** 主流程应用 e04doio3ps02（默认） */
const MAIN_APP_KEY = process.env.QINGFLOW_INBOUND_APP_KEY_2 ?? "e04doio3ps02";
// Q-Source 兜底转发地址：必须通过环境变量提供，源码不硬编码默认值。
// 未配置时 qsourceUrl 为 undefined，兜底转发将直接失败（不会静默发到未知地址）。
const MAIN_QSOURCE_URL = process.env.QSOURCE_RECEIVE_URL_2;

/** 应用注册表：key 为轻流 appKey（当前仅主流程应用在用） */
export const BPS_APPS: Record<string, BpsAppConfig> = {
  // 【已停用】[TEST_APP_KEY]: {
  //   appKey: TEST_APP_KEY,
  //   fields: DEFAULT_BPS_FIELDS,
  //   qsourceUrl: TEST_QSOURCE_URL,
  // },
  [MAIN_APP_KEY]: {
    appKey: MAIN_APP_KEY,
    fields: BPS_FIELDS_E04,
    qsourceUrl: MAIN_QSOURCE_URL,
  },
};

/** 【已停用】原测试应用 key（应用已停用） */
// export const TEST_BPS_APP_KEY = TEST_APP_KEY;

/** 主流程应用 key（默认） */
export const DEFAULT_BPS_APP_KEY = MAIN_APP_KEY;

/** 取应用配置；不传或传未知 key 时返回主流程应用（e04doio3ps02） */
export function getBpsApp(appKey?: string): BpsAppConfig {
  if (appKey && BPS_APPS[appKey]) return BPS_APPS[appKey];
  return BPS_APPS[DEFAULT_BPS_APP_KEY];
}
