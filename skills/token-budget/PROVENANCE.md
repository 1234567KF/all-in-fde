# 来源说明

## 基本信息

| 项 | 内容 |
| --- | --- |
| 技能名 | `token-budget` |
| 版本 | 0.1.0 |
| 上游 | 自研 |
| 上游版本 | — |
| 创建日期 | 2026-11-18 |
| 设计依据 | `docs/节省token技能-调研与整合方案.md`、`archive/docs/精准计费-调研与实施方案.md` |

## 范围

本技能是 all-in-fde 任务和长任务的预算层，不包含领域内容标准。它只做四件事：

1. `plan`：判断任务类型、峰谷、读取策略、模型/effort、是否拆子代理。
2. `brief`：生成子代理简报，限制返回长度。
3. `squeeze`：只压缩日志/JSON，原文落盘可 retrieve。
4. `verify`：复用 `tools/dsh-cost` 做 A/B 对比。

## 与 all-in-fde 入口、领域技能的关系

- `all-in-fde` 入口尚不存在；以后有时，在入口第一步加载本技能并执行 `plan`。
- `all-in-md`、`dashi-ppt`、`ppt-master`、`html-ppt`、`guizang-ppt` 等负责内容；本技能只负责流程和预算。冲突时领域技能的规则优先。

## 依赖

- Node.js 18+（脚本无第三方依赖）
- 可选：`tools/dsh-cost`（峰谷判断、历史均价、A/B 验证）；缺失时 `plan` 降级，`verify` 提示先同步。

## 设计取舍

- 不做 Claude Code 式 PreToolUse hook，不自动改写命令。
- 不压缩源代码/文档正文/交付物。
- 不承诺固定节省比例；效果由 `verify` 的配对置信区间和质量门判断。

## 许可证

MIT，见 `LICENSE`。
