# 来源与重建说明

## 性质

本仓库自研技能，`license: MIT`（见目录内 `LICENSE`），可随仓库公开分发。

## 依据

- 设计：[`docs/all-in-fde-方案-v0.3.md`](../../../docs/all-in-fde-方案-v0.3.md)（架构）与 [`docs/all-in-fde-v1-实现方案.md`](../../../docs/all-in-fde-v1-实现方案.md)（实现）。
- 借鉴：gspowers（导航与恢复）、mattpocock/skills（判据、依赖边、触发词）、Super-agent（Router/Worker/注意力/看门狗）、一份真实多端项目的任务拆解与 E2E 方法。内部出处见 `archive/notes/调研出处.md`（不外发）。

## 资产

- `assets/需求采集表-空白模板.xlsx` 由 `tools/build-requirement-template.py` 生成，改模板改生成器，不手改 xlsx。
- 证据 schema 与 31 条门禁 ID 见 `docs/证据schema与门禁ID对照.md`。

## 重建

以下命令在**仓库根**执行（这些脚本属于仓库，不随技能分发）：

```bash
node scripts/check-skills.mjs      # 校验技能目录结构
node scripts/sync-index.mjs        # 重建 skills.json
node scripts/sync-runtime.mjs      # 同步到 .dsh/skills
```

## 约束

- 技能产物不得出现内网地址、本机路径、内部项目名；用 `node scripts/check-public-artifacts.mjs` 把关。
- 入口只路由，步骤细节进 `references/`，用到才加载。
- 三个执行者预设（`fde-lead` / `fde-worker` / `fde-qa`）是可选增强，装在仓库的 `bundles/fde-presets/`；技能不依赖它们，缺了按 `SKILL.md` 的退回规则同屏执行。
