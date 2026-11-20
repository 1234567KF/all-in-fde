# liquid-glass-starter → all-in-fde 对齐建议清单

> 来源：2026-11-20 对 `http://192.168.110.2/starters/liquid-glass-starter`（main，commit `ff6b9677`）与本机 `.dsh/skills/all-in-fde`（v0.7.0）的逐文件对照。
> 判断口径：**不是把 starter 改成流程工具**，而是补上它缺的三类执法能力——独立复核的执行体、证据的可追溯形态、交付态的门禁。凡离开 all-in-fde 就没意义的东西（采集表、验收卡签名、波次派发）不进 starter；凡不需要跨会话记忆就能机械判定的东西（时间戳、坐标扫描、冷启动、断言写法）才是 starter 该长出来的护栏。

## 0. 先定关系：两者是同一条流水线的上下游

| 维度 | liquid-glass-starter | all-in-fde |
| --- | --- | --- |
| 本质 | 代码资产：可 clone 的全栈工程模板 + 设计系统 | 流程资产：写给 Agent 的操作规程 + Node 校验脚本 |
| 管什么 | 「结构对不对」：技术栈、目录契约、Zod 单源、AST 门禁 | 「过程骗没骗人」：五道阻断门、31 条检查项、证据 schema |
| 交集点 | `references/scaffold.md`（起架消费 starter）、`references/starter-map.md`（结构与命令映射） | 同左 |

starter 是 fde「起架」动作的实现依赖；fde 是 starter 从空目录走到交付的调度器。本清单只谈 starter 侧要往 fde 方向补的东西。

---

## A. 必须补（有真实风险敞口）

### A1. 独立复核执行体 + 「实现与复核未隔离」声明

- **现状**：`WORKFLOW.md` §5 让人做 2 分钟 Review，`AGENTS.md` 声称工程规范由门禁 100% 强制。但没有任何机制保证「改共享契约 / 权限 / 认证的代码被第二双眼睛看过」。
- **fde 对应做法**：`references/implement.md` 第 7 步——涉及共享契约/权限/认证的票**必须先派只读复核子代理重跑验收谓词**，结论落成 `.fde/evidence/qa-review-<阶段>.md`，顺序不能反；同屏实现时复核必须换模型或换会话，并在记录里写明「实现与复核未隔离」，`E5-9` 的 `evidence` 指向该记录。
- **为什么是缺口**：CI 只能证明「机器规则通过」，证明不了「这条规则这次真的被满足」。starter 最核心的资产恰恰是 `packages/shared` 契约与 RBAC——AI 改这两处的语义错误（格式写对、业务写错）AST 抓不到。
- **最小落地**：新增 `.agents/skills/independent-reviewer/SKILL.md`（只读、不改码，输入 = diff + Spec 片段 + 命令输出）；`WORKFLOW.md` §3 加硬判据：改动命中 `packages/shared/**`、`apps/api/src/middleware/**`、`*.service.ts` → 必须出复核记录，PR 附路径。零脚本成本，纯纪律 + PR 模板一个字段。

### A2. 证据时效与时序（防「旧日志背书新改动」）

- **现状**：`AGENTS.md`「变更后验证（强制）」要求代码改完立即跑对应测试并通过，「未执行 = 任务未完成」——纯自然语言约束，无任何时间戳校验。
- **fde 对应做法**：`references/checklist.md` 合法性硬约束 3/4——E5-2 的 check 日志 mtime 与 `started_at` 相差超 20 分钟即判无效；E5-9 引用的复核文件 mtime 晚于证据落盘则报「先出证据后复核」，由 `scripts/verify-evidence.mjs --strict` 拦。CHANGELOG 0.4.1 明确写了这原先「只有文字要求，脚本并不核对」。
- **为什么重要**：AI 最容易复用的就是上一次的全绿输出。starter 专门做了 `lint:nocache`（说明作者清楚缓存会造假），但对「日志造假」没有对应防线，属同类问题的另一半。
- **最小落地**：`bun run check` 结束时把 `{ commit, startedAt, finishedAt, exit, summary }` 写进 `.cache/check-report.json`；CI 或 arch-check 增加断言「该文件时间戳晚于本次 HEAD 的最后一次源码改动」。约 30 行。

### A3. 冷启动验收清单（删库 → 干净进程 → 逐角色登录 → 异常分支）

- **现状**：`ROADMAP.md` 把 E2E 测试列为 P0 待做，health-check 端点也待做；CI 跑的是单测 + 覆盖率。全链路里没有「删掉数据目录、干净进程起来、admin/user/viewer 三角色分别落到正确页面」这一步。
- **fde 对应做法**：`references/verify.md` 十步冷启动 + 每步「合格判据 vs 常见糊弄」对照表（第 1 步不真删库后面全绿都是假的；第 8 步必须用 Playwright `console` 监听计数，不许拿「静态资源 200」代理）。
- **为什么重要**：starter 生产交付是单容器动静合一 + SQLite WAL，最容易出的正是「迁移在 `:memory:` 过、在真实文件库不过」和「dev 常驻进程掩盖冷启动失败」。`deploy.sh` 的 60s health check 只证明进程活着，不等于能用。
- **最小落地**：新增 `scripts/coldstart-check.ts`（临时目录建库 → migrate → seed → 起 API → 三角色登录取 permissions → `/api/health` → 停），接入 CI `check` stage；顺带完成 ROADMAP 的 health-check 项。

### A4. 交付态 README 与内网坐标扫描

- **现状**：scaffold 把模板 README 归档为 `REFERENCE.md`，但生成项目自己的 README 内容不由 starter 保证；`.gitlab-ci.yml` 里写死 `TEST_HOST: 192.168.110.214`、`registry.cn-beijing.aliyuncs.com/wecode-cloud`、`TEST_PATH`，`--include-ci true` 会原样注入新项目。
- **fde 对应做法**：`references/delivery.md` 三条——① README 必须是项目自己的（模板名/模板端口/模板账号会让客户照它起不来），含装/起/端口/账号/回滚五段；② E7-5 内网坐标扫描，按 `192.168.`、`10.`、`localhost:`、`token` 搜，排除注释与测试夹具，命中真实配置即红，SKIP 不算通过；③ `scripts/e7-fresh-copy.mjs` 不带 node_modules/data/.git 复制到同级再照 README 起一遍。
- **为什么重要**：这是 starter 唯一「已知会把自家基础设施带进别人仓库」的地方，也是交付起不来的头号原因。
- **最小落地**：`scripts/check-portable-artifact.ts` 扫描 README/compose/env 示例中的模板名残留与内网字面量，非 0 退出，接进 `bun run check` 或 CI；scaffold 生成 README 时强制五段结构。

### A5. 数据断言规范（金额按分、期望值不得由实现重算、守恒优先）

- **现状**：`docs/specs/_template.md` §6 验收标准表已覆盖主流程/边界/越权/并发四类场景，§1.1 提示了「金额建议整数分、禁用浮点」，但**测试怎么写才算证明业务算得对**没有任何规定；`gen:module` 生成的 route.test 覆盖的是状态码与审计断言。
- **fde 对应做法**：`references/implement.md` 第 5 步——每票至少一条数值/状态/关联断言，验在接口或库上而非界面；金额按分比较；**期望值来自独立算例，不用实现重算**；守恒断言优先（汇总 = 明细和）。配套门禁 E5-4 seam 预确认、E5-5 反恒真断言、E5-6 测行为不测实现。
- **为什么重要**：starter 的目标场景是内部中后台，迟早遇到金额/库存/统计。AI 写这类测试最典型的假绿就是「用被测函数算出期望值再断言相等」。
- **最小落地**：`AGENTS.md` Testing 段加三条红线；`_template.md` §6 增列「数据断言口径」；`business-feature-builder` Phase 4 测试清单显式要求「至少一条负例 + 一条守恒断言」。纯文档，零依赖。

---

## B. 值得补（成本低、收益明确）

### B1. Spec 元信息补封版字段与需求编号

`_template.md` front-matter 现为 `module/label/version/apps/status/updatedAt`，`status` 只有 `active`。fde 侧要 `status: sealed` + `sealed_at` + `sealed_by` + `prd_refs`，靠 E2.5 阻断未封版就切片。starter 的活体 Spec 哲学刻意不要审批流（合理，别照搬封版），但**迭代起点不可追**是真问题：`version: v1.0` 无日期无署名，事后说不清「当时按哪一版做的」。
建议：加 `sealedAt` / `sealedBy`（首次落地即填，表示此版经人确认）与 `reqRefs`（指回 `docs/requirements/v<X.Y>/prd/*.md#锚点`）；`arch-check.ts` Rule 6 从「存在性」升级为「元信息完整」。

### B2. 变更影响分析（改契约前先看谁在用）

fde 有 `scripts/prd-impact.mjs`：封版后改 PRD 必须先 grep spec/tickets 列出受影响清单。starter 有 `remove:module` 的反向引用预检，但**正向传播**（改 shared 契约 / schema → 哪些模块、哪些端、哪些 Spec 段落要跟着改）完全靠人记。Monorepo 的 typecheck 能抓类型错，抓不到「字段语义变了，A 模块的守卫条件不再成立」。
建议：`scripts/impact.ts <schema名|权限码|表名>`，输出跨包引用位置 + 命中的 `docs/specs/*.md` 段落，作为改契约前的固定动作写进 `AGENTS.md`。

### B3. 票面纪律落到 docs/plans

`WORKFLOW.md` 已支持 `@docs/plans/v1.0-dev-plan.md 我要实现任务 T01`，但 plans 卡片的字段、完成态标记、谁能勾全凭约定。fde 可直接借的判据（`slice.md`）：一票一条演示路径、禁止批次票（≥3 个业务模块合一票会被 `check-tickets.mjs` 警告）、三阶段只用 ☑/☐（**禁 ◐ 这类第三态符号**，会让「做完没做完」变模糊）、AI 只能勾第一格、勾了必须有交付回执。
建议：`docs/plans/_template.md` + `scripts/check-plans.ts`（纳入 `test:scripts`），让「领任务卡」也有机器判据。

### B4. retro 判据化

starter 有 `docs/known-issues-flat-templates.md`（好苗头），但没有沉淀机制。fde 的规矩值得抄：retro 四列表 `| # | 卡点 | 当时的代价 | 下次的判据/门 |`，**写不出判据就不写**（不写感想）；节奏是「起架后、每批迁移后、验收后、交付后各补一条」，不是交付时一次性补作业。
建议：`docs/retro.md` 模板 + `AGENTS.md` 一句「新增 ESLint 规则/门禁条目前，先查 retro 是否已登记该坑」。

### B5. 分层归属显式化（把 starter-map 变成 starter 自己的文档）

`references/starter-map.md` 实质是在**外部替 starter 补齐了一张「哪类改动进哪层 + 门禁分工」表**。内容全在 starter 地盘（`AGENTS.md` 分包表 + `arch-check.ts` 九条规则 + CI 注释），只是分散且面向 AI。
建议：starter 出一份人类向 `docs/CHANGE-MAP.md`（改动类型 × 落点 × 走不走生成器 × 谁的门禁管它），fde 那份映射表随后退化为「指向 starter 文档」。这与 `modular-architecture-design.md` §1 批评的「剥离规则写在 scaffold、被剥离代码写在模板，两处需人工同步」是同一个病。

### B6. flat 模板的契约空洞（starter 自己已承认）

`docs/known-issues-flat-templates.md` 与 `modular-architecture-design.md` §9.4 都写了「flat 的 shared 契约缺失属既有问题」。fde 立场很硬：契约单源是白盒组件之外最重要的两项之一（`scaffold.md` 事故记录原话——「丢了白盒组件、契约单源与架构门禁」）。README 提到异构后端改用 OpenAPI（`swaggo`/`springdoc` + `openapi-typescript`/`Orval`），但只是提醒用户，模板里没有可跑配方。
建议：flat-go / flat-java 模板至少出一个最小样例——后端产出 `openapi.json` + 前端 `services/api.d.ts` 生成脚本 + CI 里的契约漂移检测（重新生成后有 diff 即红）。

---

## C. 反向修正（fde 这边该改，不要去动 starter）

| 现象 | 实际情况 | 该改谁 |
| --- | --- | --- |
| `scaffold.md` 说坐标第 4 档兜底是技能自带副本 `.dsh/starter/liquid-glass-starter` | 本机实配走第 2 档 `~/.dsh/all-in-fde/starter.json` → `localPath = ~/.dsh/all-in-fde/starter/liquid-glass-starter`（存在，ref `完整副本-2026-11-19`）；`starter-info.mjs` 的 bundled 兜底分支在当前布局下是死代码 | **fde**：文档措辞与脚本兜底路径对齐 |
| `starter.json` 的 `scaffoldCmd` 指向 `<localPath>/tools/scaffolder/scripts/scaffold.ts`，上游仓库实际是 `skills/wecode-project-scaffolder/scripts/scaffold.ts` | 本地副本已改名（另有 `tools/move-scaffolder.mjs`），属刻意的脱敏产物差异 | **fde**：在 starter.json `notes` 里注明「副本布局 ≠ 上游路径」，避免下次换副本踩坑 |
| `scripts/README.md` 列了 `check-review-stamp.mjs`、`spec-coverage.mjs`、`assets/prd-split-manifest.md`、`assets/spec-skeleton.md` | 本技能目录一度缺失（v0.7.0 声称新增） | **fde**：补齐或标注「仅仓库级可用」 |
| 采集表 S0–S15、`REQ-/AC-/BR-/FLD-` 编号族、HTML 理解卡/提案卡、token-budget 预算档位 | 纯需求工程与成本控制层 | **不动 starter**，保持 fde 私有 |

**一处真正的冲突**：starter 明令「请勿删除/改写 `[gen:module:*]` 注释锚点」（`AGENTS.md` 代码区块与锚点禁手删），而 fde 的 `slice.md` / `implement.md` 从未提这条约束——Worker 若顺手清理注册文件注释就会打断生成器。建议在 `starter-map.md` 加一行**禁区清单**（`[gen:module:*]` 锚点、`#region module:*`、`feature:*`、`LONG_FILE_RATCHET` 基线形态），并把它并入 Worker 授权范围的默认排除项。

---

## D. 新增建议：README 补一份完整的文件夹结构示意

参考 starter README「项目结构与架构门禁」那一节的写法（一张带行内注释的树 + 紧随其后的依赖方向规则 + 提升策略），给 all-in-fde 的 README 补一节同等密度的结构说明。当前 README 只有一张六行的顶层树，读者看不出「一次交付跑完会在磁盘上留下什么、每个文件归谁写、哪些能删」。

目标结构（建议直接放进 README，注释按下面口径写）：

```text
all-in-fde/                          # 仓库根 = .dsh 的上级目录，giget 下载即用
├── .dsh/
│   ├── skills/                      # 技能本体，一个技能一个目录（运行时唯一一份）
│   │   ├── all-in-fde/              # 入口技能（Router）
│   │   │   ├── SKILL.md             # 入口：角色、先读现场、七动作、加载规则
│   │   │   ├── META.json            # 版本/许可/上游的唯一真源
│   │   │   ├── PROVENANCE.md        # 来源、依据文档、重建命令、外发约束
│   │   │   ├── CHANGELOG.md         # 每版一条，写「落成哪条判据/哪个门」
│   │   │   ├── LICENSE
│   │   │   ├── references/          # 九个动作的执行细则，一次只加载一份
│   │   │   │   ├── understand.md    # 收活·理解 + 提案（两轮卡片）
│   │   │   │   ├── intake.md        # 收活·出采集表
│   │   │   │   ├── spec.md          # 校准：采集表→PRD→原型→spec→封版
│   │   │   │   ├── slice.md         # 切片与派发（含推理档判定）
│   │   │   │   ├── scaffold.md      # 起架：脚手架坐标契约
│   │   │   │   ├── implement.md     # 逐单：实现+自测+证据（Worker 用）
│   │   │   │   ├── verify.md        # 验收：独立复核+冷启动+E2E（QA 用）
│   │   │   │   ├── delivery.md      # 交付：三件套+干净目录复跑+retro
│   │   │   │   ├── checklist.md     # 门禁手册：五道阻断门 + 31 条 ID + 证据 schema
│   │   │   │   └── starter-map.md   # 脚手架目录职责/改动落层/门禁分工
│   │   │   ├── scripts/             # 确定性执法器（agent 只调用，不手写产物）
│   │   │   │   ├── starter-info.mjs         # 解析脚手架坐标，缺坐标退出码 3
│   │   │   │   ├── ensure-tmp.mjs           # 建 .fde-tmp/ 并写进 .git/info/exclude
│   │   │   │   ├── gen-understand-card.mjs  # 理解卡 HTML
│   │   │   │   ├── check-review-stamp.mjs   # 采集表核验戳
│   │   │   │   ├── spec-coverage.mjs        # AC/BR/REQ/页面双向差集
│   │   │   │   ├── prd-impact.mjs           # PRD 变更影响清单
│   │   │   │   ├── check-tickets.mjs        # 票依赖图 + 票面纪律
│   │   │   │   ├── e0-selfcheck.mjs         # 环境自检（E0）
│   │   │   │   ├── card-evidence.mjs        # 验收卡 → E6 证据（带 signature）
│   │   │   │   ├── verify-evidence.mjs      # 证据合法性校验（--strict）
│   │   │   │   ├── e7-fresh-copy.mjs        # 干净目录复跑
│   │   │   │   ├── safe-remove.mjs          # 删目录前体检
│   │   │   │   └── clean-tmp.mjs            # 临时产物清理
│   │   │   └── assets/              # 模板件：采集表 xlsx、spec 骨架、PRD 分卷清单
│   │   ├── token-budget/            # 预算层（plan/stat），自带 vendor/dsh-cost
│   │   ├── ponytail/                # 最小改动纪律，档位随推理档联动
│   │   ├── ai-flavor-guard/         # 中文文案去 AI 味
│   │   └── rea-video/               # 视频逆向拆解（与本流程无关）
│   ├── bundles/fde-presets/         # 三个子代理预设：fde-lead / fde-worker / fde-qa
│   └── starter/liquid-glass-starter/  # 本地脚手架底座（Bun+Hono+Drizzle+React19）
│       ├── apps/{web,api}/          # 端与后端；生成项目沿用同构
│       ├── packages/{shared,ui,web-core}/  # Zod 契约单源 / 白盒组件 / 前端内核
│       ├── eslint-rules/            # 自定义 AST 架构门禁
│       ├── scripts/                 # gen:module / arch-check / strip-features …
│       ├── tools/scaffolder/        # scaffold.ts（上游叫 skills/wecode-project-scaffolder）
│       └── AGENTS.md DESIGN.md WORKFLOW.md   # 交给生成项目的三份规范
├── scripts/                         # 仓库级校验：bootstrap / check-skills / sync-index / check-links / check-public-artifacts
├── docs/                            # 方案、skill-spec、versioning、release、证据 schema 对照、采集表模板说明
├── .github/                         # PR 模板与 CI 校验
├── skills.json                      # 机器可读索引（由 sync-index.mjs 生成，勿手改）
├── AGENTS.md SKILLS.md INSTALL.md CONTRIBUTING.md NOTICE.md README.md
└── （以下不进版本库）
    ├── .tmp/                        # 仓库自身中间产物
    ├── archive/ deliverables/ tools/   # 本地留档与本地工具
    └── .dsh/<会话数据目录>           # 运行数据

# 跑一次交付后，目标工作区会长成这样（与上面的技能目录互不重叠）：
<项目工作区>/
├── .fde/                            # 正式产物，进版本库
│   ├── brief.md                     # 五节需求摘要
│   ├── starter.json                 # 脚手架坐标 + 端口（下次会话直接复用）
│   ├── prd.md 或 prd/               # 一级真源（分卷模式含 index.md）
│   ├── spec/<module>.md + data-model/api-map/glossary.md   # 二级真源
│   ├── tickets/<票号>-<slug>.md     # 票（三阶段勾选）
│   ├── cards/E6-<卡号>.md           # 人填的验收卡
│   ├── evidence/E0-*,E2.5-*,E5-*,E6-*,E7-*.json   # 只能由脚本或卡片产出
│   └── handoff/ retro.md
└── .fde-tmp/                        # 截图/trace/日志/草稿，本机排除，随时可整目录删
```

配套要写的三句话（照 starter 那种「树 + 规则」的写法，别只贴树）：

1. **依赖方向**：`SKILL.md` 只做路由，动作细节在 `references/`，用到才加载；`scripts/` 是执法器，agent 只调用不代写产物；`assets/` 是模板，不是产物。
2. **两个临时目录的区别**：仓库根的 `.tmp/` 是给仓库开发用的，工作区根的 `.fde-tmp/` 是给每次交付用的，后者由 `ensure-tmp.mjs` 写进 `.git/info/exclude`，绝不改对方 `.gitignore`。
3. **`.fde/` 与 `.fde-tmp/` 的分界**：前者是交付物与证据（进版本库、可回溯），后者是调试残留（收尾前核对 `git ls-files .fde-tmp` 为空）。

---

## E. 优先级汇总

| 优先 | 项 | 成本 | 一句话理由 |
| --- | --- | --- | --- |
| P0 | A4 内网坐标扫描 + 交付态 README | 1 个脚本 | 唯一会泄漏自家基础设施、且客户照文档起不来的风险 |
| P0 | A3 冷启动清单（含 health 端点） | 1 脚本 + CI 一步 | ROADMAP 自标 P0；现有全绿证明不了「干净环境能用」 |
| P0 | A1 独立复核执行体 | 1 份 SKILL.md + PR 字段 | 契约/RBAC 的语义错误 AST 抓不到 |
| P0 | D README 结构示意（含工作区产物树） | 纯文档 | 新人/AI 分不清「技能目录」与「交付产物」，误删与误提交都在这里发生 |
| P1 | A2 证据时效与时序 | ~30 行 | 堵住「旧日志背书新改动」，与 lint:nocache 同源动机 |
| P1 | A5 数据断言规范 | 纯文档 | 中后台必然遇到，AI 最容易在此假绿 |
| P1 | B1 Spec 封版字段 + reqRefs | 模板 + arch-check 一条 | 让迭代起点可追 |
| P2 | B2 impact 脚本 / B3 plans 票面纪律 / B5 CHANGE-MAP | 各 1 小项 | 提升可维护性，非阻断 |
| P2 | B6 flat 契约配方 | 中等 | 影响异构路线，monorepo 主路不受影响 |
| — | C 全部 | fde 侧 | 别让 starter 背流程工具的账 |
