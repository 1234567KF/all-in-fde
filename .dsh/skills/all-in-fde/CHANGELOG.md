# 变更记录

## [0.7.1]

**白皮书核心要义自检后的两处补漏**（对照「四权分立 / 快准顺省」）：

- **E2.5 封版门脚本执法**（补「需求对齐权」执法缺口）：此前 `verify-evidence.mjs` 的文件名正则与 `GATE_IDS` 都不认 E2.5，`E2.5-sealed.json` 被静默忽略——宣称阻断却纯荣誉制。现纳入执法：识别 `E2.5-*.json` 与 5 个 item（E2.5-1 PRD封版 / -2 业务spec封版 / -3 固定专题封版 / -4 追溯非空 / -5 覆盖率差集空），门级 PASS 必须带封版人签名 `signature.by`（脚本不许自封），E2.5-5 PASS 应附覆盖率摘要或 S15 豁免。checklist 检查项 31→36，新增合法性硬约束第 5 条；spec.md 第 20 步写明 item 与签名。四夹具实测：合规过、缺签名/缺项/FAIL项均拦。
- **「人的三处」重写为「人的三类触点」**：旧段落与 12 步流水线矛盾（声称人只审采集表五页，实则理解卡/提案卡/PRD/spec 都要人审）。改为拍板（各设计决策审定）/走查（每票）/封卡（验收）三类，与白皮书「人的心流用在设计决策、检查、抽查」对齐；明确 AI 只勾①、②③人来、封版封卡须具名签名。
- checklist 标题「四道阻断门」→「五道阻断门」（E2.5 加入后遗留笔误）。

## [0.7.0]

**PRD/spec 章节模式与数据设计补位**（来自营销模块实战反馈）：

- **P0-1 spec 固定专题**（`spec.md` 阶段C 步骤13）：新增 `data-model.md`（逐列定义+索引+迁移计划）、`api-map.md`（全量路由×权限码×schema）、`glossary.md`（编号族速查+易混词）。与业务模块 spec 并列生成、并列审定、并列封版。裁决顺序：物理列名看 data-model，业务口径指回 S8/S9，冲突改 data-model 不改采集表。
- **P0-2 PRD 分卷模式规范化**（`spec.md` 阶段B 步骤6）：重写为双模式（单文件 / 分卷）。分卷模式吸收真实多端项目验证过的结构：7 个固定横切卷（00-decisions / 01-roles / 02-flows / 03-ia-pages / 08-rules / 09-acceptance / 10-delivery-openitems）+ 端×域纵切卷。配套 SSOT 声明、HOLD 编号、每卷管/不管声明。新增 `assets/prd-split-manifest.md` 模板。
- **P0-3 变更传播链**（`spec.md` 阶段D 步骤18）：新增 `scripts/prd-impact.mjs`，grep spec/tickets 中的章节或编号，输出受影响文件清单。封版后改 PRD 必须先跑它。spec 元信息新增机器可读字段 `prd_refs`。
- **P1-4 核验戳脚本执法**（`spec.md` 阶段A 步骤3、`intake.md` 出口判据）：新增 `scripts/check-review-stamp.mjs`，校验采集表 xlsx 指定 sheet 的「客户核验」列。阶段 A→B 门禁从「AI 自认为审过」变成「脚本说审过」。
- **P1-5 UI 事实源裁决块**（`spec.md` 步骤12 模板 §4）：spec 模板 §4 固定三行裁决块（业务展示口径=S7；视觉=DESIGN.md+packages/ui；冲突时前者赢业务后者赢呈现）。
- **P1-6 spec 覆盖率核验**（`spec.md` 阶段C 步骤16、阶段D 步骤19）：新增 `scripts/spec-coverage.mjs`，AC/BR/REQ/页面双向差集报告，差集非空不许封版。新增 `assets/spec-skeleton.md` 六节模板。
- **P2-8 保留字清单**（`spec.md` 阶段C 步骤11）：data-model / api-map / glossary / INDEX 为固定专题专用名，业务模块不得使用。
- **checklist.md E2.5 增强**：固定专题 sealed + spec-coverage 差集为空纳入封版检查项。
- **scripts/README.md**：新增 prd-impact / check-review-stamp / spec-coverage 三个脚本条目。

## [0.6.0]

**12 步流水线 + liquid-glass 理解卡 + 六个人审触点**：

- **12 步全流程对齐**：人梳理需求 → AI 理解提问 → 人回复 → AI 粗提案 → 人审定 → AI 采集表 → 人审定 → AI PRD → 人审定 → AI 原型 → 人审定 → AI spec → 人审定 → 封版 → 切片→交付。每步都有明确的人审触点，未审定不许进下一步。
- **理解卡拆为两阶段**：§A 理解+提问（HTML 卡片或 DSH 交互选择题）→ §B 粗提案（HTML 卡片）。不再合并成一张卡。
- **liquid-glass 设计系统**：理解卡 HTML 模板全面采用 liquid-glass-starter 的 theme-tokens.css 变量体系（玻璃面板、翡翠绿主色、Inter/Manrope 字体、语义色阶），与脚手架生成的项目视觉一致。
- **spec.md 重写**：四阶段改为 A(采集表人审) → B(PRD+原型+各自人审) → C(spec+人审) → D(封版)。每个人审触点显式化为阻断性步骤。
- **intake.md 重写**：只负责"从已审定提案生成采集表"，不再从零收原文。前提是 understand.md §B 已完成。
- **SKILL.md**：先读现场增加到 18 个中间态；七步表格扩展为 9 行（收活拆为理解/提案/出采集表三步）。
- **流程图 HTML**：按 12 步重做，liquid-glass 风格，区分人步（橙色渐变）和 AI 步（蓝色渐变）。

## [0.5.1]

**新增理解卡环节（v0.5.1）**：

- **新增 `references/understand.md`**：在收活之后、填采集表之前，AI 主动生成 HTML 理解卡（用 `present` 展示），让人快速确认 AI 的理解是否正确、有没有遗漏、方案设想是否合理。六个区块：核心理解 / 关键疑问 / 初步方案 / 范围边界 / 利益相关者 / 下一步行动。
- **新增 `scripts/gen-understand-card.mjs`**：接收结构化 JSON，输出单文件深色主题 HTML，零外部依赖。
- **SKILL.md**：先读现场增加「理解卡未确认」「理解卡已确认」两个中间态；七步表格拆分为「收活·理解卡」+「收活·出brief」两步；加载规则表增加 understand.md。
- **intake.md**：前提改为「理解卡已确认」，从理解卡提取内容沉淀到 brief + S0，不再从零收原文。
- **spec.md**：阶段A入口改为「brief.md 齐（理解卡已确认）」。
- **设计理念**：贯彻「先理解、先提问、先设想方案」，让人在填表前就与 AI 共脑同频；HTML 卡片比纯文本 brief 更易读、主次分明；理解卡不落盘为证据，确认后内容进 brief/采集表即可。

## [0.5.0]

**三级真源 + 封版门禁 + ponytail 档位联动**：

- **核心真源从采集表迁移到 PRD → spec**：采集表只是输入，PRD 是第一级真源（可单文件 `prd.md` 或分块 `prd/<章节>.md`），`spec/<module>.md` 是第二级真源（按业务模块命名）。切片依据改为 PRD + spec 的整体技术方案，不再是采集表行号。
- **新增 E2.5 封版门禁（阻断）**：PRD + 所有 spec 必须标记 `status: sealed`、追溯完整后才能进切片。未封版就切片 = 流程错误。证据文件 `E2.5-sealed.json`。
- **spec.md 重写**：拆成四阶段（填表→出PRD→出spec→封版），含 PRD 推荐结构、拆分规则、元信息块格式、spec 推荐结构、封版检查清单。
- **ponytail 档位联动**：推理档 off→lite / low,high→full / max→ultra。Worker persona 同步更新，按派发 prompt 里的档位切换。
- **slice.md**：切片入口从「采集表+PRD已定」改为「PRD+spec已封版」；分组依据从 S7 页面行改为 spec 模块边界；票的 Spec 字段路径改为 `spec/<module>.md#章节`；新增 ponytail 档位联动表。
- **SKILL.md**：先读现场增加 PRD/spec/封版三个中间态；七步表格校准行更新；阻断门从四道变五道。
- **checklist.md**：新增 E2.5 封版条目；阻断门表更新为五道。
- **starter-map.md**：两处约定从「规格模板二选一」改为「三级真源」。
- **intake.md**：明确收活出口是 brief+S0，不是 PRD。
- **fde-presets**：Worker persona 更新 ponytail 档位联动指令。

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
