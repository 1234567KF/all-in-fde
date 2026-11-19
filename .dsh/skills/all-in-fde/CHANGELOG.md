# 变更记录

## [0.4.1]

复核 v0.4.0 时发现 5 处没收干净，补掉：

- `verify.md` 的 QA 预设名写成 `fde-verify`（实际是 `fde-qa`），`implement.md` 写成 `fde-逐单`（实际是 `fde-worker`）——派发时会指向不存在的预设。
- `scaffold.md` 的一处换行被写成字面量 `\n`，两条常见错粘成一行。
- `PROVENANCE.md` 仍引用已删除的 `sync-runtime.mjs`，且 bundles 路径停留在重命名前。
- `e7-fresh-copy.mjs` 把退出码判定写成 `!== 1`：包管理器退出 2/127 时会被当成成功，属于会制造假绿的缺陷；改为「非 0 即失败」。
- E5-2 时效、E5-9 时序此前只有文字要求，`verify-evidence.mjs` 并不核对；现在脚本兜底：日志 mtime 与 `started_at` 超 20 分钟、E5-9 指向的复核记录不存在、复核文件晚于证据落盘，`--strict` 下直接报错。\n- 新增 `scripts/safe-remove.mjs`：删目录前断言「文件都已入库」「不是当前工作目录或其祖先」，把「删除类操作前置断言」从建议变成可执行动作。

## [0.4.0]

来自一次真实项目（一码通溯源系统）的复盘反馈，逐条落成判据/脚本：

- **验收卡有可执行落盘路径**：新增 `scripts/card-evidence.mjs`。人填卡片 → 脚本合成 E6 证据（带 `signature`），未点选拒绝封卡、有问题写 FAIL；其余九项只能来自脚本证据。此前没有落盘工具，出现过「脚本把 E6-9 判 PASS」的假证据。
- **E6-9 只能由卡片产出**：`verify-evidence.mjs` 校验 `by.kind` 与 `signature`；脚本产出的 E6 里 E6-9 只能是 SKIP/FAIL。
- **一条门一个文件**：`verify-evidence.mjs` 检测同 `gate+target` 重复 `revision`，`--strict` 下报错；文档要求重跑覆盖同名文件。
- **E5-2 时效**：明确「check 日志必须在 20 分钟内」，`implement.md` 要求记录日志路径与时间。
- **E5-9 时序**：先复核、后出证据；同屏实现时复核必须换模型只读，并写明「实现与复核未隔离」。
- **票面纪律**：`check-tickets.mjs` 拦第三态符号（◐）、勾①无回执、挂 REQ 超过 3 个前缀的批次票告警；`slice.md` 增加「一票一条演示路径」硬规则与批次票反例。
- **E7 干净目录复跑**：新增 `scripts/e7-fresh-copy.mjs`（复制时不带依赖/数据/.git，可 `--run` 装与跑门禁）。
- **E6 十步判据**：`verify.md` 补齐「控制台 A 类错用 Playwright console 监听」「E2E 需无头/有头 parity」的具体做法。
- **换栈证据序列**：`checklist.md` 新增换栈/换目录/换进程模型时的阶段前缀与 `supersedes` 规则。
- **临时产物**：`SKILL.md` 增加收尾核对 `git ls-files .fde-tmp` 为空；明确还原被跟踪文件用 `git checkout`，禁止文本管道（会导致换行丢失、忽略规则失效）。
- **坐标与端口**：`scaffold.md` 要求把 `name@ref`、命令与端口写进 `.fde/starter.json`。
- **retro 节奏**：起架后、每批迁移后、验收后、交付后各补一条，不只交付时跑一次。

## [0.3.3]

- 脚手架坐标增加第 4 档兜底：技能自带的 `.dsh/starter/liquid-glass-starter`，开箱即用、零配置。
- 仓库新增 `AGENTS.md` 与 `scripts/bootstrap.mjs`：giget 下载后由 AI 读 AGENTS.md，自动跑 bun 安装与空门禁自检。

## [0.3.2]

- 脚手架改为**本机完整副本**：从内网下载一次后，运行期零网络（模板本地、端口分配默认关闭）。不做删减式脱敏，CI/部署/端口分配器都保留，只是默认不触发。
- `starter-info --check-reach` 只检查本机副本存在性。

## [0.3.1]

- 试验过「删减式脱敏」：去掉 CI、部署脚本与端口分配。该做法丢能力，已被 0.3.2 取代。

## [0.3.0]

- 修「起架缺坐标」：新增脚手架坐标契约（`.fde/starter.json` → 本机 → 环境变量），`scripts/starter-info.mjs` 负责解析与可达性检查；没有坐标时退出码 3，强制先问人不许自建。
- 新增 `references/starter-map.md`：目录职责、改动落层、门禁分工，以及规格模板与模块实现归属两处约定。
- `scaffold.md` 重写：取法、生成、多端、空门禁、E3 证据必须记 `starter` 或 `skipped`。
- `slice.md` 的票命令改为真命令；`checklist.md` 的 E0-5 改为「脚手架可达」，E3 增加记录要求；`e0-selfcheck.mjs` 接入可达性检查。

## [0.2.2]

- 对接 `token-budget`：开工 `plan`，收尾/用户说“统计”执行 `stat.mjs`，生成当前工作空间看板。
- 加载规则允许主动加载 `token-budget`；新会话只说“统计”由 `token-budget` 直接出看板。

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
