---
name: all-in-fde
description: 把一段需求推进到可验收的小型 IT 系统时使用。触发：用户说「我要做个 XX 系统 / 功能 / 页面」「帮我把这个需求变成能用的东西」「我不会写代码但想要个能管 XX 的工具」「继续上次那个项目」。流程：填需求采集表让人审定 → 出 PRD → 出模块 spec → 封版 → 切片分工 → 逐票实现自测 → 冷启动验收 → 交付。不用于：纯咨询与写文档/PPT、给已有项目加单个字段（走脚手架领域技能）、多模块要流水线并行的大项目。
metadata:
  version: "0.7.1"
---

# all-in-fde

把「会用电脑的人 + 一段话需求」推进到「可验收的小型 IT 系统」。你不替人记住进度，你让每一步都留下能复跑的验收证据。

三种执行者加一个人，各司其职：

| 角色 | 预设 id | 职责 |
| --- | --- | --- |
| Router（本入口） | `fde-lead` | 拆分、派发、排期、收口；不写实现 |
| Worker | `fde-worker` | 一票一代理：实现 + 自测 + 交证据；没有向人提问的工具 |
| QA | `fde-qa` | 独立复核 + 冷启动 + E2E；只读审代码 |
| 人 | —— | 拍板、走查、封卡 |

派发写法：用 `subagent` 工具，`agent_preset` 填 `fde-worker`（实现票）或 `fde-qa`（验收票），一次只派一张票，同一批文件不派两个 Worker；同时按票的类型定推理档（`off`/`low`/`high`/`max`，见 `references/slice.md` 的「派发时定档」），别一律拉满。

**预设没装时不能卡住**：三个预设是可选增强。检测不到 `fde-worker`，就退回同会话执行——单票项目本来就该同屏做完；检测不到 `fde-qa`，就由人按 `references/verify.md` 逐项走查。退回时在自测报告写一句「预设未装，同屏执行」。

**同屏实现的代价要补回来**：实现与复核同源时，「独立复核」会退化成自我确认。此时必须做两件事，否则 E5-9 判无效：

1. 复核换成**不同模型或不同会话**的只读子代理，只拿票 + Spec + 证据，重跑验收谓词；
2. 复核记录里写明「实现与复核未隔离」，并在 E5-9 的 `evidence` 指向该记录。

## 先读现场

开工第一件事：扫描工作目录，按「动作产物」判断停在哪，不读记忆、不写状态字段。

```text
无 brief.md                              → 收活·理解（references/understand.md §阶段A）
有理解卡未确认                           → 收活·等待反馈（references/understand.md §阶段A）
理解已确认、无提案                       → 收活·提案（references/understand.md §阶段B）
提案已审定、无采集表                     → 收活·出采集表（references/intake.md）
有采集表未审定                           → 校准·等人审（references/spec.md §阶段A）
采集表已审定、无 PRD                     → 校准·出PRD（references/spec.md §阶段B）
有 PRD 未审定                            → 校准·等人审PRD（references/spec.md §阶段B）
PRD 已审定、无原型                       → 校准·出原型（references/spec.md §阶段B）
有原型未审定                             → 校准·等人审原型（references/spec.md §阶段B）
原型已审定、无 spec/                     → 校准·出spec（references/spec.md §阶段C）
有 spec 未审定                           → 校准·等人审spec（references/spec.md §阶段C）
spec 已审定、未封版                      → 校准·封版（references/spec.md §阶段D）
已封版、无票                             → 切片（references/slice.md）
有票、项目未起                           → 起架（references/scaffold.md）
项目已起、有 todo 票                     → 逐单（references/implement.md）
全部票 done、未验收                      → 验收（references/verify.md）
验收过                                   → 交付（references/delivery.md）
```

跳过动作要写进 evidence（`skipped: true` + 理由）。跳的是准备动作，出口门禁（E5、E6）不许跳。

## 七个动作

| 动作 | 做什么 | 出口判据 | 详见 |
| --- | --- | --- | --- |
| 收活·理解 | AI 解析需求 → 理解卡(HTML/选择题) → 人回复确认 | 理解已确认 | understand.md §A |
| 收活·提案 | AI 出粗提案卡(HTML) → 人审定 | 提案已审定 | understand.md §B |
| 收活·出采集表 | 提案 + 理解 → 采集表 | 采集表生成 | intake.md |
| 校准 | 采集表(人审定) → PRD(人审定) → 原型(人审定) → spec(人审定) → 封版 | E2 四查过 + **E2.5 封版 PASS** | spec.md |
| 切片 | PRD + spec → 一组票（分工依据是技术方案） | 每票可演示、依赖无环 | slice.md |
| 起架 | 读坐标并用脚手架生成项目 | 空项目 `check` 绿 + E3 记 starter/skipped | scaffold.md |
| 逐单 | 实现 + 自测 + 证据 | 验收谓词逐条有证据、数据断言不为零 | implement.md |
| 验收 | 复核 + 冷启动 + E2E | 四步全过、卡无「有问题」 | verify.md |
| 交付 | 三件套 + 回流 | 干净目录可起、可回滚 | delivery.md |

## 什么算做完

五道阻断门：**E0 环境、E2.5 封版、E5 实现、E6 人用、E7 交付**。E1–E4 只记录、不阻断。门的条目、36 个 ID、证据字段与聚合规则见 `references/checklist.md`。

证据规则：

- 证据文件按 `fde.evidence/v1` 的 schema 写，只能由脚本或卡片工具产出，**agent 只读不写**。
- 一条门一个文件（同一 `gate + target` 只留一份；重跑覆盖同名文件，或升 `revision` 并写 `supersedes`）：`evidence/E0-*.json`、`E5-<票号>.json`、`E6-<卡号>.json`、`E7-*.json`。
- 三态 PASS / FAIL / SKIP；SKIP 必须写原因，不算通过。
- **E6-9（验收卡）只能由 `scripts/card-evidence.mjs` 从人填好的卡片产出**，带 `signature`。脚本产出的 E6 里 E6-9 只能是 SKIP 或 FAIL——「AI 跑通了同一条链路」不等于「人确认了」。
- 交付前跑 `node scripts/verify-evidence.mjs .fde/evidence --strict`，退出 0 才算过。
- **对外汇报逐门报状态**（`E0 PASS / E5 PASS / E6 FAIL（待人点选）/ E7 PASS`），不写「四门全绿」这种总括词——总括词会把「待人确认」吞掉。

## 票

最小字段见 `references/slice.md`。三条铁律：

1. 切法三条判据：竖切（一条用户能演示的完整路径）、一次上下文装得下、阻塞边真实。**切片依据是 PRD + spec 的整体技术方案**，不是采集表的行号。
2. 三阶段勾选：`① AI 首轮实现` `② 人走查` `③ QA 封卡`。**AI 只能勾①**。
3. 票挂 `REQ-`、验收引 `AC-`，Spec 引 `spec/<module>.md#章节`，不许现编编号。

## 人的三类触点

人的心流只用在设计决策、检查、抽查上（白皮书要义），其余一律静默。三类触点贯穿 12 步：

1. **拍板**（设计决策）：理解卡确认、提案卡审定、采集表审定（重点五页：S0 原话、S3 角色、S5 主链、S7 页面、S13 疑问）、PRD/原型/spec 审定与封版。每处人都可回答「是」接受推荐假设，不同意才打字改。
2. **走查**（检查）：每票实现后 2 分钟走查（对照原型与「擦屁股清单」），勾票面第②格。
3. **封卡**（抽查）：验收卡点选，其中固定一项抽 1–2 笔数据手工验算，勾第③格。

AI 只能勾票面第①格；②③必须人来。封版（E2.5）与封卡（E6-9）都要具名签名，脚本不许代人拍板。

## 临时产物

在其他工作区跑本技能时，中间产物只写**该工作区根目录**的 `.fde-tmp/`，并且不进对方的版本库。

开跑第一步，在工作区根执行：

```bash
node <技能目录>/scripts/ensure-tmp.mjs
```

它做两件事，都幂等：建 `.fde-tmp/` 与 README；把 `.fde-tmp/` 写进该仓库的 `.git/info/exclude`。**这是本机排除，不会进提交**——所以既不改对方的 `.gitignore`，也不会让 `git status` 出现未跟踪文件。脚本会自己向上找最近的 `.git`，子目录工作区写的是相对路径，worktree 也能识别。非 git 目录只建目录，跳过排除。

| 写进去 | 不写进去 |
| --- | --- |
| 截图、trace、日志、导出中间件、草稿、临时表格 | 交付物、证据 JSON、票、规格书、brief |

四条硬规矩：

1. 没跑 `ensure-tmp.mjs` 就开始写中间文件，算流程错误。
2. 不往工作区根目录扔文件；`.fde/` 只放 brief、票、证据、handoff、retro。
3. 任务收尾说一句「`.fde-tmp/` 可删」；按时间清用 `<技能目录>/scripts/clean-tmp.mjs --older-than 7`。
4. **绝不修改对方的 `.gitignore` 或任何被跟踪文件**——排除只走 `.git/info/exclude`。

收尾前核一条：`git ls-files .fde-tmp` 必须为空（临时产物一旦入库，交付物就混着调试残留；要清用 `git rm -r --cached .fde-tmp`）。

### 会话交接件（handoff）

`.fde/handoff/<日期>-<动作>.md`：会话中途要换人、换会话、或预计上下文将满时写一份，供新会话冷启动续作。「先读现场」扫到 handoff 时，以最新一份为准接动作，产物状态仍以文件扫描为准（handoff 说的是意图，产物说的是事实，冲突信事实）。

四节，从上到下：

1. **下个会话要做什么**：一句话目标 + 停在哪个动作（用「先读现场」的动作名）。
2. **本轮结论**：只写产物文件里没有的信息——人已拍板但还没回写规格的决定、被否决的方案与否决理由、踩过的坑。**已经写进 brief/采集表/PRD/spec/票的内容一律不复述，给路径指针。**
3. **待人事项**：未闭环的人审触点、HOLD/待确认项，逐条含具体可答的问题（不写「请补充信息」这种没法答的）。
4. **下一步加载**：写明下一个会话该读哪份 reference、该跑哪个脚本。

硬规矩：
- 敏感信息（密钥、内网地址、账号）不落 handoff，与交付前内网坐标扫描同一口径。
- handoff 是过程件不是证据：不进 `evidence/`，不参与门禁校验，E5/E6 的 evidence 字段不许指向它。
- 一次会话最多收尾写一份；重复写覆盖同名文件，不堆时间戳版本。

**唯一例外**：E7 干净目录副本（`e7-fresh-copy.mjs`）放在项目**同级**而不是 `.fde-tmp/`——`fs.cpSync` 不允许把目录复制进自身子树。副本路径写进 E7 证据，归档前可删。

还原被跟踪文件一律用 `git checkout <commit> -- <path>`；**不要用文本管道**（`git show … | Out-File` 会把换行压成一行、让忽略规则整体失效，一次 `git add -A` 就能把几十万个依赖文件塞进索引）。

**删目录前先体检**：`node <技能目录>/scripts/safe-remove.mjs <目录>`，它会拦两件事——目标里有未入库文件（删了就真没了）、目标是当前工作目录或其祖先。体检过后加 `--yes` 才真删；`--force` 只用于明确已知代价的情况，先备份。

## 边界（不做什么）

- 不做流水线平台、低代码平台、模型微调
- 不给已有项目加单个字段（走脚手架领域技能）
- 不碰多模块要大并发并行流水线的项目
- 不承诺零人工：人花在设计决策 + 抽查，单模块 ≤30 分钟

## 预算与统计

本入口默认配合 `token-budget`，这是唯一允许主动加载的外部技能。**规则适用于本会话的整个生命周期**：不止流水线动作，会话中的派子代理、贴长日志、后续普通问答同样按这四条走。

- **开工 / 任何实质性任务**：执行 `plan --task "<用户原话>"`，按返回的 `effort`/`readStrategy` 走；高峰时把 `suggestDefer` 提示给用户一次，不代做决定。
- **派子代理（含 Worker/QA）**：先 `brief.mjs --goal ... --max-return 1500` 生成简报当 prompt；票面有 `#task=` 标签的首行带上。
- **要贴进对话的命令日志超 ~200 行**：先 `squeeze.mjs` 压缩再引用；源代码与文档正文永不压缩。
- **收尾 / 用户说“统计”**：执行 `token-budget/scripts/stat.mjs`，生成当前工作空间 `.dsh/dsh-cost/dashboard.html`，用 `present` 交给用户。
- **新会话只说“统计”**：不需要重新走 all-in-fde，`token-budget` 会按当前工作空间直接出看板。
- `token-budget` 未装时不阻塞流程，继续用现有技能；统计改用可用的 `dsh-cost`。质量优先于省钱，不因省流工具卡住正题。

## 加载规则

本技能自包含，**不依赖仓库里的其他文件**；除 `token-budget` 外不主动加载别的技能。

| 什么时候 | 加载什么 | 加载哪个 |
| --- | --- | --- |
| 按「先读现场」判断出动作 | 只加载那一个动作的 reference | `references/{understand,intake,spec,slice,scaffold,implement,verify,delivery}.md` |
| 写证据、跑门禁、判通过 | 加载门禁手册 | `references/checklist.md` |
| 开工 / 收尾 / 用户说统计 | 加载预算与统计 | `token-budget`（`plan` / `stat`） |
| 进逐单、要写代码 | 额外加载 `ponytail`，档位随推理档联动 | off→lite / low,high→full / max→ultra；没装就跳过并在自测报告写「未装」 |

三条约束：

1. **一次只加载一份 reference**，不预加载下一个动作；动作切换时才换。
2. 除 `token-budget`、`ponytail` 外不主动加载其他技能（文档、PPT、表格类技能与本流程无关）。
3. 编号与字段名以 `references/checklist.md` 为准，不另起名字。

## 交付后

跑 `retro`：复盘这次哪里卡住、哪条证据事后被证明是假的，把它变成一条判据或一道门，写进 `retro.md`。没有可执行改动就写「无」。

**节奏不是只在交付时跑一次**：起架后、每批迁移后、验收后、交付后各补一条。写不出判据的，说明还没想清楚，不写。
