---
name: all-in-fde
description: 把一段需求推进到可验收的小型 IT 系统时使用。触发：用户说「我要做个 XX 系统 / 功能 / 页面」「帮我把这个需求变成能用的东西」「我不会写代码但想要个能管 XX 的工具」「继续上次那个项目」。流程：填需求采集表让人审定 → 拆成票 → 生成 PRD 与原型 → 逐票实现并自测 → 冷启动验收 → 交付。不用于：纯咨询与写文档/PPT、给已有项目加单个字段（走脚手架领域技能）、多模块要流水线并行的大项目。
metadata:
  version: "0.4.1"
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
无 brief.md                        → 收活（references/intake.md）
有 brief、无采集表/PRD             → 校准（references/spec.md）
有规格、无票                       → 切片（references/slice.md）
有票、项目未起                     → 起架（references/scaffold.md）
项目已起、有 todo 票               → 逐单（references/implement.md）
全部票 done、未验收                → 验收（references/verify.md）
验收过                            → 交付（references/delivery.md）
```

跳过动作要写进 evidence（`skipped: true` + 理由）。跳的是准备动作，出口门禁（E5、E6）不许跳。

## 七个动作

| 动作 | 做什么 | 出口判据 | 详见 |
| --- | --- | --- | --- |
| 收活 | 一段话 → brief + 采集表 S0 | brief 五节齐、S0 至少一条 | intake.md |
| 校准 | 采集表 → PRD → 原型 | 表无空表、S15 无缺口、编号可回溯 | spec.md |
| 切片 | 规格 → 一组票 | 每票一上下文可完成、可演示、依赖无环 | slice.md |
| 起架 | 读坐标并用脚手架生成项目（无坐标先问人，不许自建） | 空项目 `check` 绿 + E3 记 `starter` 或 `skipped` | scaffold.md |
| 逐单 | 实现 + 自测 + 证据（起架后先看对照表） | 验收谓词逐条有证据、数据断言不为零 | implement.md、starter-map.md |
| 验收 | 复核 + 冷启动 + E2E | 四步全过、卡无「有问题」 | verify.md |
| 交付 | 三件套 + 回流 | 干净目录可起、可回滚 | delivery.md |

## 什么算做完

四道阻断门：**E0 环境、E5 实现、E6 人用、E7 交付**。E1–E4 只记录、不阻断。四道门的条目、31 个 ID、证据字段与聚合规则见 `references/checklist.md`。

证据规则：

- 证据文件按 `fde.evidence/v1` 的 schema 写，只能由脚本或卡片工具产出，**agent 只读不写**。
- 一条门一个文件（同一 `gate + target` 只留一份；重跑覆盖同名文件，或升 `revision` 并写 `supersedes`）：`evidence/E0-*.json`、`E5-<票号>.json`、`E6-<卡号>.json`、`E7-*.json`。
- 三态 PASS / FAIL / SKIP；SKIP 必须写原因，不算通过。
- **E6-9（验收卡）只能由 `scripts/card-evidence.mjs` 从人填好的卡片产出**，带 `signature`。脚本产出的 E6 里 E6-9 只能是 SKIP 或 FAIL——「AI 跑通了同一条链路」不等于「人确认了」。
- 交付前跑 `node scripts/verify-evidence.mjs .fde/evidence --strict`，退出 0 才算过。
- **对外汇报逐门报状态**（`E0 PASS / E5 PASS / E6 FAIL（待人点选）/ E7 PASS`），不写「四门全绿」这种总括词——总括词会把「待人确认」吞掉。

## 票

最小字段见 `references/slice.md`。三条铁律：

1. 切法三条判据：竖切（一条用户能演示的完整路径）、一次上下文装得下、阻塞边真实。
2. 三阶段勾选：`① AI 首轮实现` `② 人走查` `③ QA 封卡`。**AI 只能勾①**。
3. 票挂 `REQ-`、验收引 `AC-`，不许现编编号。

## 人的三处

人只在这三处出现，其余一律静默：

1. **拍板**：A1 只请人审采集表五页（S0 原话、S3 角色、S5 主链、S7 页面、S13 疑问）
2. **走查**：每票实现后 2 分钟走查（对照原型与「擦屁股清单」）
3. **封卡**：验收卡点选，其中固定一项抽 1–2 笔数据手工验算

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

**唯一例外**：E7 干净目录副本（`e7-fresh-copy.mjs`）放在项目**同级**而不是 `.fde-tmp/`——`fs.cpSync` 不允许把目录复制进自身子树。副本路径写进 E7 证据，归档前可删。

还原被跟踪文件一律用 `git checkout <commit> -- <path>`；**不要用文本管道**（`git show … | Out-File` 会把换行压成一行、让忽略规则整体失效，一次 `git add -A` 就能把几十万个依赖文件塞进索引）。

**删目录前先体检**：`node <技能目录>/scripts/safe-remove.mjs <目录>`，它会拦两件事——目标里有未入库文件（删了就真没了）、目标是当前工作目录或其祖先。体检过后加 `--yes` 才真删；`--force` 只用于明确已知代价的情况，先备份。

## 边界（不做什么）

- 不做流水线平台、低代码平台、模型微调
- 不给已有项目加单个字段（走脚手架领域技能）
- 不碰多模块要大并发并行流水线的项目
- 不承诺零人工：人花在设计决策 + 抽查，单模块 ≤30 分钟

## 预算与统计

本入口默认配合 `token-budget`，这是唯一允许主动加载的外部技能：

- **开工**：加载 `token-budget`，执行 `plan --task "<用户原话>"`，按返回的 playbook 走。
- **收尾 / 用户说“统计”**：执行 `token-budget/scripts/stat.mjs`，生成当前工作空间 `.dsh/dsh-cost/dashboard.html`，用 `present` 交给用户。
- **新会话只说“统计”**：不需要重新走 all-in-fde，`token-budget` 会按当前工作空间直接出看板。
- `token-budget` 未装时不阻塞流程，继续用现有技能；统计改用可用的 `dsh-cost`。

## 加载规则

本技能自包含，**不依赖仓库里的其他文件**；除 `token-budget` 外不主动加载别的技能。

| 什么时候 | 加载什么 | 加载哪个 |
| --- | --- | --- |
| 按「先读现场」判断出动作 | 只加载那一个动作的 reference | `references/{intake,spec,slice,scaffold,implement,verify,delivery}.md` |
| 写证据、跑门禁、判通过 | 加载门禁手册 | `references/checklist.md` |
| 开工 / 收尾 / 用户说统计 | 加载预算与统计 | `token-budget`（`plan` / `stat`） |
| 进逐单、要写代码 | 额外加载 `ponytail`（full 档） | 外部技能，没装就跳过并在自测报告写「未装」 |

三条约束：

1. **一次只加载一份 reference**，不预加载下一个动作；动作切换时才换。
2. 除 `token-budget`、`ponytail` 外不主动加载其他技能（文档、PPT、表格类技能与本流程无关）。
3. 编号与字段名以 `references/checklist.md` 为准，不另起名字。

## 交付后

跑 `retro`：复盘这次哪里卡住、哪条证据事后被证明是假的，把它变成一条判据或一道门，写进 `retro.md`。没有可执行改动就写「无」。

**节奏不是只在交付时跑一次**：起架后、每批迁移后、验收后、交付后各补一条。写不出判据的，说明还没想清楚，不写。
