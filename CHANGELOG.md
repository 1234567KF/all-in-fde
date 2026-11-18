# 变更记录

本文件记录技能库本身的变更：目录规范、脚本、归档动作。单个技能的变更记录在 `skills/<name>/CHANGELOG.md`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.1.1] - 2026-11-18

### Removed

- 删除 `templates/skill/`。新技能暂不按统一规范编写，模板用不上；`docs/skill-spec.md` 与 `scripts/check-skills.mjs` 保留，作字段参考和校验用。

## [0.1.0] - 2026-11-18

### Added

- 建立目录规范与技能模板：`templates/skill/`。
- 归档 5 个技能：`ai-flavor-guard` 0.1.0、`dashi-ppt` 0.4.14、`guizang-ppt` 0.1.0、`html-ppt` 0.1.0、`ppt-master` 6.9.0。
- 每个技能补 `META.json`、`PROVENANCE.md`、`CHANGELOG.md`，记录来源、许可和导入范围。
- 新增 `NOTICE.md`，汇总第三方许可与再分发条件。
- 新增 `scripts/check-skills.mjs`（校验）与 `scripts/sync-index.mjs`（生成 `skills/skills.json`）。
- 新增 `docs/skill-spec.md`、`docs/versioning.md`、`docs/release.md`。
- 新增 PR 模板与 GitHub Actions 校验工作流。

### Changed

- 根目录整理：方案文档、白皮书、调研稿移入 `archive/docs/`，探针脚本与临时目录移入 `archive/scratch/`，引用资料移入 `archive/reference/`。这些目录不进版本库。
- 技能快照剔除 `node_modules`（`dashi-ppt` 约 62 MB），恢复方式见各技能的 `PROVENANCE.md`。

### Notes

- 仓库暂未配置远端，不推送到 GitHub。
- `ai-flavor-guard` 与 `dashi-ppt` 缺许可证，公开前须处理。
