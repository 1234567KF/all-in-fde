# 变更记录

本文件记录技能库本身的变更：目录规范、脚本、归档动作。单个技能的变更记录在 `skills/<name>/CHANGELOG.md`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [0.9.1] - 2026-11-23

### Changed

- `all-in-fde` 0.7.2：提案卡的「预估工作量」改为报价参考口径（1 人天 ≈ 10 个简单 CRUD 模块或 3 个复杂模块，向上取整到 0.5 天），明确 AI 实现不按人天估时排期；修复 `understand.md` 指向不存在的 `gen-proposal-card.mjs` 的悬空引用。
- `token-budget` 0.4.3：修预算模式报「未安装」——全局 `~/.dsh/skills` 缺 token-budget 联接；`fde-budget` 预设（presets 0.2.1）把 `node ~/.dsh/...` 改为 `node "$HOME/.dsh/..."`（PowerShell 不展开字面 `~`），并加全局 → 工作区 → 技能目录的回退链。
- README 技能表版本对齐。

## [0.9.0] - 2026-11-21

### Added

- `all-in-fde` 0.7.1：E2.5 封版门纳入脚本执法（识别 `E2.5-*.json` 与 5 个 item，PASS 必须带封版人签名，脚本不许自封）；「人的三处」改写为「人的三类触点」，与 12 步流水线对齐；新增 `assets/prd-template.md` PRD 结构模板（519 行，含单文件与分卷两种落点）。
- `docs/dsh-minimax-motionharness-安装教程.md`：DSH + MiniMax 图像插件 + MotionHarness 的安装教程（人操作版 + AI 代理版）。

### Changed

- checklist 标题「四道阻断门」改为「五道阻断门」，检查项 31 → 36。

### Removed

- 删掉 `.fde/prd-template.md`：与技能资产里的同名文件重复，且是旧版（少一处章节映射修正）。`.fde/` 是项目正式产物目录，不该在技能库里留副本。
- 6 张 `images/minimax-*.jpg` 是生成测试图、没有任何文档引用，移到 `.tmp/generated-images/`（不进版本库）。

## [0.8.2] - 2026-11-20

### Changed

- `token-budget` 0.4.2：`pricing.json` 联网核实（DeepSeek / MiniMax M3 / GLM-5.2 / Qwen 3.8·3.6 官方页），新增 `_sources` 记录来源 URL 与抓取日期；Qwen 套餐与 `glm-5.2` 改用官方原价（USD）基准；MiniMax-M2.7 官方页已下架，改按聚合站折算并保留 `_needVerify`。

## [0.8.1] - 2026-11-20

### Fixed

- `token-budget` 0.4.1：`scripts/install.mjs` 在技能已位于 `.dsh/skills` 时，dry-run 会算出嵌套的 `.dsh/.dsh/skills/...` 联接路径。改为识别「已就位」，dry-run 只打印技能位置，`--remove` 不误删运行时目录。

## [0.8.0] - 2026-11-20

### Added

- `all-in-fde` 0.7.0：PRD 分卷模式规范化（7 个横切卷 + 端×域纵切卷、SSOT 声明、HOLD 编号），spec 阶段 C 固定三份专题 `data-model.md` / `api-map.md` / `glossary.md`，新增 `assets/prd-split-manifest.md` 模板。
- `token-budget` 0.4.0：新增 `fde-budget` 预设（`@local/dsh-fde-presets` 0.2.0），脱离 all-in-fde 的会话也能用省流纪律；pricing 补全 qwen 与 minimax 单价，unknown 占比从 27.7% 降到 0%。
- `AGENTS.md` 新增「省流与计费」一节：开工 plan、派子代理先 brief、长日志先 squeeze、统计直接出看板，跨工作区生效。

### Changed

- `verify-evidence.mjs` 等门禁脚本随流程调整；`vendor/dsh-cost` 同步到最新（含 dashboard、turns、scope）。

## [0.7.0] - 2026-11-20

### Added

- `.dsh/starter/liquid-glass-starter` 入库：Bun + Hono + Drizzle + React 的本地脚手架底座，411 个文件，内网依赖已净化（公开镜像、占位符、目录改名），起项目不 clone、不联网。
- `AGENTS.md`：工作区说明——先 `node scripts/bootstrap.mjs` 装依赖并跑 `bun run check`，绿了再开工；三个预设与改动边界也写在这里。
- `all-in-fde` 0.6.0：12 步流水线 + 六个人审触点，新增 `references/understand.md`（理解卡 / 提案卡两阶段）与 `scripts/gen-understand-card.mjs`，spec 重写为 A/B/C/D 四阶段。
- `token-budget` 0.3.0：新增 `stat` 动作与 `scripts/stat.mjs`，按当前工作空间出 `.dsh/dsh-cost/dashboard.html`。

### Changed

- `scripts/check-public-artifacts.mjs` 与相关脚本脱敏：门禁脚本不再带内部地址与本地路径。
- `scripts/project-scaffolder` 挪到 `tools/scaffolder`，避免与 `.dsh/skills` 概念嵌套。
- README 补「起一个项目」一节与脚手架目录；技能清单版本更新到 all-in-fde 0.6.0、token-budget 0.3.0。

### Notes

- `.gitignore` 增加 `/.fde-tmp/`：技能在任意工作区会用它，这里也兜一层。

## [0.6.1] - 2026-11-19

### Removed

- `dashi-ppt` 从全部 git 历史中删除（`git filter-repo --invert-paths`）。它没有许可证，不应继续存在于公开仓库的任何版本里。

### Notes

- 历史重写导致**所有提交哈希与标签改写**。已有 clone 必须重新 clone，不能 `git pull`。
- 本机仓库从 57.5 MiB 降到 36.3 MiB；`dashi-ppt` 仍留档在 `archive/skills/`，不进版本库。
- GitHub 的缓存与已有 fork 可能仍留有旧对象，彻底清除需联系 GitHub Support。

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
