# 变更记录

## [0.4.0] - 2026-11-20

### Added

- **`fde-budget` 预设**（随 `@local/dsh-fde-presets` v0.2.0 安装）：脱离 all-in-fde 的通用会话也能触发省流纪律——非平凡任务开工跑 plan、派子代理先出 brief、长日志先 squeeze、问计费直接出 stat。选「FDE 预算」预设即可。
- SKILL.md 新增「脱离 all-in-fde 使用」一节，说明两种独立用法与路径注意事项。

### Changed

- pricing.json 补全 qwen-token-plan-individual（qwen3.8-flash/max、glm-5.2、qwen3.6-flash、deepseek-v4-pro-0813）与 minimax-cn M2.7/highspeed；unknown 从 27.7% 降到 0%。占位单价标 `_needVerify` 待核实。
- classifyTask：「做/建 + 系统/平台/模块」判为 code，修复 IT 需求误判 doc。
- plan 输出新增 `suggestDefer` 字段（高峰时提示可推迟，不自动建定时任务）。

## [0.3.0] - 2026-11-19

### Added

- `scripts/stat.mjs`：按当前工作空间生成 `.dsh/dsh-cost/dashboard.html`；其他工作空间默认统计该空间全部历史，当前空间若有计费起点则按起点。
- `stat` 动作：用户只说“统计 / 看计费 / 看板”时直接出当前工作空间看板，不需要每次让模型写 Markdown。
- `vendor/dsh-cost` 同步到带 `dashboard`、`turns`、`scope` 的版本。

### Changed

- 技能描述加入“统计 / 看计费 / 看板”触发词。
- 与已存在的 `all-in-fde` 入口对接：开工 `plan`，收尾/统计 `stat`。

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
