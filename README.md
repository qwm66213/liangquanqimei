# 粮全齐美数据看板

从轻流「正式-【仓库】数据流水」按商品+仓库汇总期初、期末与区间入出库。

## 启动

```bash
cp .env.example .env.local   # 填入 QINGFLOW_APP_KEY / QINGFLOW_ACCESS_TOKEN
npm install
npm run dev
```

打开 http://localhost:3055

> 注意：本机 `3000` 端口已被其他 Next 服务占用（会返回 Unauthorized）。本应用固定使用 **3055**。

## 目录说明

| 目录 | 内容 |
| --- | --- |
| `src/` | Next.js 应用源码（`app/` 页面与 `/api/*` 接口） |
| `public/` | 静态资源 |
| `scripts/` | 数据处理 / 验证脚本（Python / TS），路径多为本地绝对路径；`install.bat` 为一键安装+启动脚本（内部已 `cd` 到项目根） |
| `qsource-call/` | BPS 入库联调用的真实报文样例（`_qsource_body*.json`、`单商品报文拆解_S060101001.json`） |
| `docs/` | 文档与参考数据：业务流程文档、Codex 安装教程、`bps-response-examples.json`（BPS 返回示例）、`form_e04.json`（轻流入库应用表单结构快照） |
| `excel-data/` | 全部 Excel 数据表（门店统计、进销存、盘点、排期等），仅本地分析用 |
| `pdf_images/`、`downloads/`、`icons/` | 历史过程产物与素材，当前代码未引用 |

> `scripts/` 下的脚本会读写 `excel-data/` 与 `qsource-call/`，移动或重命名这两个目录时需同步修改脚本内的路径。

## 接口

`GET /api/summary?startDate=2026-07-01&endDate=2026-07-30&warehouse=&productCode=&productName=`

## 校验

```bash
npm run verify:aggregate
```
