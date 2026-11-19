# 变更记录

## [0.2.1]

- 新增 `scripts/ensure-tmp.mjs`：建 `.fde-tmp/` 并把相对路径写进本机 `.git/info/exclude`，保证临时产物不进对方版本库；不改 `.gitignore`，支持子目录与 worktree。
- `SKILL.md` 明确「开跑第一步跑 ensure-tmp」，四条硬规矩同步收紧。

## [0.2.0]

- 新增临时产物约定：中间产物只写工作区根目录 `.fde-tmp/`，附 `scripts/clean-tmp.mjs`（预览 / `--all` / `--older-than`）。
- 四份 reference 补上落点：实现日志、验收截图与 trace、规格草稿、交付打包临时件。

## [0.1.0] - 2026-11-19

- 首版：入口 `SKILL.md`（Router）+ 七份 reference（收活 / 校准 / 切片 / 起架 / 逐单 / 验收 / 交付）+ 需求采集表模板资产。
- 证据 schema、门禁 ID、任务卡融合、数据断言、无头/有头分工，均按 `docs/all-in-fde-v1-实现方案.md` 落地。
- 补 `LICENSE`（MIT），随仓库公开分发。
