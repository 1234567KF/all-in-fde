# 脚本说明

| 脚本 | 状态 | 说明 |
| --- | --- | --- |
| `verify-evidence.mjs` | 可用 | 校验证据文件 shape、ID 全集、门级一致性 |
| `e0-selfcheck.mjs` | 可用 | 环境自检，三态退出码 0/1/2 |
| `check-tickets.mjs` | 可用 | 票依赖图：引用存在、无环、列出可开工的根票 |
| `seed-demo` | 随脚手架落地 | 单源造数，dev-only；依赖脚手架的表结构 |
| `e2e-run` | 随脚手架落地 | 双 project 跑批，依赖 Playwright 配置 |

`seed-demo` 与 `e2e-run` 依赖具体脚手架，不在这里写死；脚手架接入时按 `references/scaffold.md` 与 `references/verify.md` 生成。

仓库级校验脚本（**不在本技能内**，只在仓库里可用）：`scripts/check-public-artifacts.mjs`（产物净化）、`scripts/check-links.mjs`（链接可达）、`scripts/check-skills.mjs`（技能目录校验）。技能单独安装时这些不存在，不影响运行。
