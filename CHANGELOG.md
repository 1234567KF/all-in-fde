# 变更记录

本文件记录技能库本身的变更：目录规范、脚本、归档动作。单个技能的变更记录在 `skills/<name>/CHANGELOG.md`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.6.0] - 2026-11-19

### Added

- `ai-flavor-guard` 补 MIT 许可证（0.1.1），`META.json` 改为 `license: MIT`、`redistributable: true`。5 个随包技能现在都有明确许可证，公开分发不再有阻塞项。

### Changed

- `NOTICE.md` 移除「需要处理的一项」，随包技能表补齐许可证与版本。
- 归档 `all-in-fde` 0.2.1：新增 `scripts/ensure-tmp.mjs`（`.fde-tmp/` 写入本机 exclude）、`scripts/clean-tmp.mjs`，四份 reference 补临时产物落点。

## [0.5.0] - 2026-11-19

### Changed

- 四个 PPT 类技能移出分发：`dashi-ppt`、`guizang-ppt`、`html-ppt`、`ppt-master` 从 `.dsh/skills/` 移除，本机留档在 `archive/skills/`（不进版本库）。四者合计约 170 MB，是 `giget` 下载失败的主因。
- 随仓库分发的技能变为 5 个：`all-in-fde`、`ai-flavor-guard`、`token-budget`、`ponytail`、`rea-video`，整包不到 1 MB。
- 移出技能的元数据保留在 `docs/skills/<name>.json`；完整来源说明可用 `git show v0.4.0:.dsh/skills/<name>/PROVENANCE.md` 取回。
- `INSTALL.md` 的全局安装与单技能命令改用 `.dsh/skills` 子路径。

### Notes

- 实测 `npx giget@latest gh:1234567KF/all-in-fde` 在 58 MB 的包上反复报 `zlib: unexpected end of file`，换 token、清 npx 缓存都复现；瘦身后下载恢复正常。

## [0.4.0] - 2026-11-19

### Changed

- 仓库根改成 DSH 工作区：技能从 `skills/` 迁到 `.dsh/skills/`，预设从 `bundles/` 迁到 `.dsh/bundles/`。`npx giget@latest gh:1234567KF/all-in-fde "<项目路径>"` 下载完即得到可直接加载的 `.dsh`，不再有源码副本与运行时副本两份。
- 索引文件移到仓库根：`skills/skills.json` → `skills.json`，`skills/README.md` → `SKILLS.md`。
- 校验脚本与文档同步改用 `.dsh/skills` 路径；`.gitattributes` 的 vendored 标记跟着改。

### Removed

- 删除 `scripts/sync-runtime.mjs`、`.githooks/post-commit`、`docs/runtime-sync.md`：两份副本合并成一份后，同步与钩子没有存在意义。

### Notes

- 运行时另行安装、不属于本仓库的技能（`graphify`）按名字列进 `.gitignore`，不随仓库分发。

## [0.3.0] - 2026-11-19

### Added

- 入口技能 `all-in-fde` 0.1.0：七份 reference、三个脚本（E0 自检 / 票据检查 / 证据校验）、需求采集表模板、评测集。
- 技能 `ponytail` 5.3.3、`rea-video` 0.1.0。
- `bundles/fde-presets`：`fde-lead` / `fde-worker` / `fde-qa` 三个 DSH 子代理预设。
- [INSTALL.md](INSTALL.md)：用 `giget` 只取 `skills/` 子目录，一条命令落到项目级或全局 `.dsh/skills`，含更新、卸载与验证。
- `scripts/check-links.mjs`（Markdown 相对链接）与 `scripts/check-public-artifacts.mjs`（内网地址、本机路径、内部项目名）。
- `token-budget` 0.2.0：自带 `vendor/dsh-cost`，新增 `doctor.mjs`、`package.mjs`、`sync-vendor.mjs`。

### Changed

- 技能目录改为自包含：安装后不再需要仓库里的其他文件，`giget` 只下载 `skills/` 也能直接用。
- `token-budget/scripts/install.mjs`：技能已经位于 `.dsh/skills` 时跳过目录联接，不再生成嵌套的 `.dsh/.dsh`。
- README 去掉本机 MinGit 绝对路径，补安装段、新技能与预设计算目录。

### Removed

- 删除 `dist/` 构建产物（`package.mjs` 可随时重新生成）与文档工具中间产物目录。

## [0.2.0] - 2026-11-18

### Added

- `scripts/sync-runtime.mjs`：仓库副本 `skills/` 与运行时 `.dsh/skills/` 单向同步，支持 `--check`、`--pull`、`--global`、`--prune`，跳过依赖与运行产物，遇到目录联接不写入。
- `.githooks/post-commit`：提交后自动同步运行时，`git config core.hooksPath .githooks` 启用。
- `.tmp/` 统一临时目录，配套 `scripts/clean-tmp.mjs`（预览 / `--all` / `--older-than` / `--legacy`）。
- `docs/runtime-sync.md`：同步规则、跳过清单、联接处理、反向同步说明。
- 归档 `token-budget` 0.1.0。

### Changed

- 临时脚本与测试产物从 `archive/scratch/` 迁到 `.tmp/legacy/`；`archive/` 只留归档文档和引用资料。
- `.gitignore` 增加测试产物规则（`test-output/`、`coverage/`、`__snapshots__/`、`artifacts/` 等）。
- 仓库改为公开，`README` 与 `NOTICE.md` 更新为公开后的状态。

### Notes

- `dashi-ppt` 与 `ai-flavor-guard` 仍无许可证，现已随公开仓库分发，需尽快补许可或移除。

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
