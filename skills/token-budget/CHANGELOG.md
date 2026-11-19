# 变更记录

## [0.2.0] - 2026-11-18

### Added

- `dsh-cost` 依赖绑定：`scripts/lib/dsh-cost.mjs` 按 `DSH_COST_HOME` → `~/.dsh/dsh-cost` → `vendor/dsh-cost` → `tools/dsh-cost` 解析。
- `scripts/install.mjs`：安装 dsh-cost 到用户目录、迁移账本/报表、挂载技能；支持 `--home`、`--dry-run`、`--remove`。
- `scripts/package.mjs`：生成包含 `vendor/dsh-cost` 的免克隆安装包。
- `vendor/dsh-cost/`：技能自带 dsh-cost 代码副本，`sync-vendor.mjs` 从 `tools/dsh-cost` 同步。
- `scripts/doctor.mjs`：检查依赖路径、账本、epoch、summary。
- `plan`/`verify`/`squeeze` 改用统一的依赖解析，不再写死 `tools/dsh-cost`。

### Changed

- `dsh-cost` 默认数据仍在代码目录旁；安装到 `~/.dsh/dsh-cost` 后自动使用该目录下的 `data/`、`reports/`。
- 版本 0.2.0。

## [0.1.0] - 2026-11-18

### Added

- 新增 `token-budget` 技能：`plan`、`brief`、`squeeze`、`verify` 四个动作。
- 新增决策表与压缩矩阵：`references/policy.md`。
- 新增四类 playbook：长文、代码、PPT、调研。
- 新增无依赖 Node 脚本与自检 `scripts/selftest.mjs`。
- 压缩只允许日志/JSON，原文落盘可 `retrieve`；拒绝代码/文档/交付物。
- A/B 验证复用 `tools/dsh-cost`，不重复实现计费。

### Notes

- 初始版本不接入 DSH 插件，不做自动 hook；通过技能触发和脚本显式调用。
- 峰谷判断依赖 `tools/dsh-cost/pricing.json`；缺失时降级为“未知”。
- `all-in-fde` 入口尚不存在；以后有时，在入口第一步加载本技能并执行 `plan`。
