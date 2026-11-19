---
name: project-scaffolder
description: Scaffold a new project, initialize a project workspace, and setup a full-stack TS Monorepo, Go, or Kotlin Spring Boot architecture from the Liquid Glass / ExampleOrg starter template. Also supports adding a GitLab CI/CD pipeline to an existing scaffolded project.
---

# Scaffolding Workflow

When triggered, first classify the user's intent:

- **Intent A: Initialize a new project** (“新建项目 / 初始化 / 搭个脚手架”) → Phase 1 + Phase 2 下面。
- **Intent B: Add CI to an existing project** (“为已有项目加 CI / 加个流水线 / 接部署配置”) → 跳至下方 “Utility: 为已有项目添加 CI”。
- **Intent C: Refresh template cache & skill** (“更新模板 / 拉最新模板 / 更新技能”) → 跳至 “Utility: Update Template Cache Only”。
- **Intent D: Add / remove a Web app** (“加一个企业端 / 再加个移动端 / 多端 / 删掉某个端”) → 跳至 “Utility: 增删 Web 端”。

Otherwise, treat as Intent A by default.

> **任何 Intent 都可能收到退出码 3**：这不是失败，是「本地技能已自更新，必须重跑」。按下方 [技能自更新与重启协议](#技能自更新与重启协议) 处理，不要当成错误上报给用户，也不要改用旧流程继续。

## Phase 1: Inversion (Interview)

Before writing any files, you MUST interview the user in Chinese to gather the configuration parameters. Make sure to remind the user that **Bun** must be installed on their system to run the template. Ask the following questions in a friendly, structured manner:

1. **项目名称** (Project Name, e.g., `my-liquid-app`)
2. **目标物理路径** (Target Directory absolute path, e.g., `/Users/username/Desktop/my-liquid-app`). **Ask the user whether to scaffold directly inside the current directory** (the current workspace root) or **create a new subfolder**.
   - If they choose the current directory, use the absolute path of the current workspace root.
   - If they specify a custom parent directory (e.g., `/Users/acker/Desktop/Project`), append the project name to it to construct the target path (e.g., `/Users/acker/Desktop/Project/<PROJECT_NAME>`).
3. **架构选型** (Architecture Choice):
   - **A) [Recommended] 全栈 TS Monorepo** (Vite+React + Hono API + Bun Workspaces. _Reason for Tech: Zero context switching, write TypeScript end-to-end, shared type safety via workspaces. Reason for Non-Tech: Best for rapid MVP/product delivery, lowest development cost, fastest time-to-market._)
   - **B) 平铺异构结构** (Frontend React + Backend Go/Kotlin in separate flat folders. _Reason for Tech: Best for separated concerns and independent scaling. Reason for Non-Tech: Best for large corporate projects where frontend and backend are built by different dedicated teams._)
4. **后端语言** (Only if B is chosen):
   - **A) [Recommended] Go** (GORM + SQLite. _Reason for Tech: Starts in milliseconds, 20MB RAM under load, excellent concurrency. Reason for Non-Tech: Extremely cost-effective on servers, lightweight, and starts instantly._)
   - **B) Kotlin (Spring Boot + Gradle)** (Spring Boot JPA + H2. _Reason for Tech: Enterprise ecosystems, strict OOP, Java compatibility. Reason for Non-Tech: Best for traditional corporate compliance, heavy transactional systems, or Java-standardized teams._)
5. **是否配置数据库/ORM层** (Configure Database / ORM?):
   - **none (仅平铺异构 A/B 可选；全栈 TS Monorepo 不支持，脚本会直接报错)**: 不使用数据库 (No database, keeps boilerplate static. _Reason for Non-Tech: Best for quick visual demos, client pitches, or static mock-ups. Zero database setup or maintenance required._)
   - **drizzle [Recommended for TS, Monorepo 默认]**: Drizzle ORM + SQLite (仅在选择 A 全栈 TS 时可用。_Reason for Tech: Zero heavy query engines, zero setup, natively supported by Bun, 100% type-safe. Reason for Non-Tech: Standard database setup for unified TS projects._)
   - **gorm [Recommended for Go]**: GORM + SQLite (仅在选择 B Go 后端时可用。_Reason for Tech: Go's most mature ORM with rich features and community resources. Reason for Non-Tech: Standard database setup for Go projects._)
   - **jpa [Recommended for Kotlin]**: Spring Boot JPA + H2 (仅在选择 B Kotlin 后端时可用。_Reason for Tech: Enterprise-standard JPA stability and transaction management. Reason for Non-Tech: Standard database setup for Kotlin/Java projects._)
6. **是否清理演示页面** (Clean Demo Pages? y/N):
   - **[Recommended] N / No** (Keep demo pages. _Reason: Retains functional dashboards, login templates, charts, and overlay examples to serve as copy-pasteable reference code._)
   - **y / Yes** (Clean up all boilerplate code, leaving a blank startup template shell.)
7. **是否剥离消息中心** (Clean Notification Center? y/N):
   - **[Recommended] N / No** (保留消息中心。_Reason: monorepo 后端内置 `/notifications` API + SSE + `notify()` 写入内核，顶栏铃铛与通知面板可直接作为业务通知的现成消费端。_)
   - **y / Yes** (剥离通知 UI 切片：顶栏铃铛 / `NotificationCenter` 组件 / SSE 订阅 / service+hooks / 演示页，以及后端 `modules/notification` 与演示种子。_注意：Tier 0 的 `notify / notifyMany / notifySafe` 写入内核与 `notifications` 表始终保留，业务代码无需改动。_)
8. **是否现在就配置 GitLab CI/CD** (Configure GitLab CI/CD now? y/N):
   - **[Recommended] N / No** (跟随 MVP 优先哲学，暂不注入 CI 文件。待代码结构稳定后，可随时调用本技能并说明“为此项目加 CI”来追加配置。)
   - **y / Yes** (一次性注入 `.gitlab-ci.yml` / `Dockerfile` / `ci-tools/` / `deploy.sh` / `compose.yml` / `compose.test.yml` / `compose.preprod.yml` / `.dockerignore`，过后需到 GitLab 项目的 CI/CD Variables 里配合环境变量，详见 `references/ci-guide.md`。预发布链路默认关闭，配 `PREPROD_HOST` 才启用，见该文档 §10，**不要为此多问一个问题**。)
9. **需要几个 Web 前端入口** (How many Web frontends? 仅架构选型 A 全栈 TS Monorepo 时问):
   - **[Recommended] 1 个**（管理后台一体）→ 不再追问，产物与单端完全一致，不加 `--web-apps`。
   - **多个** → 逐端追问：**端 id**（小写字母开头，只含小写字母/数字/连字符，等于目录名与包名，`web` / `api` 保留）、**名称**（中文标题）、**端形态**（`克隆管理端同款（默认）` 适合后台/企业门户；`极简空壳（"blank": true）` 仅继承工程底座并生成无登录、无侧边栏的干净起步壳，适合官网 / 独立 H5 / 大屏，且与准入互斥）、以及选「同款」时追问 **是否限制角色进入**。URL 前缀默认 `/<id>/`、dev 端口自动取现有端最大值 +1，用户不主动提就**不要追问**。
   - 所有端共用同一套 React + Vite（同源子路径，共享 `@workspace/ui` 与 `@workspace/web-core`），均带 `viewport-fit=cover` 与触屏基线 CSS；默认克隆态自带 `MobileTabBar` 与底部 Sheet 抽屉（含安全区让位），`--blank` 空壳则完全按该端自身需求写独立布局。**非 React 前端（uniapp / Taro / 小程序等）不由本技能生成**——用户提出时说明这条边界，由项目按需自带 repo 与构建，只共享后端 API。
   - 追问「是否限制角色进入」时必须说明：这只是**体验层**准入（防止误入、隐藏入口），真正的越权防线仍是后端每个路由的 `requirePermission`；选「是」会注册 `app:<id>` 权限码，admin 自动持有，其他角色需手工加进 `ROLE_PERMISSIONS`。

Stop and wait for the user's response. Do NOT proceed to the pipeline phase until all inputs are resolved.

_Note on target folder validation_: Before executing the script, check if the `<TARGET_PATH>` exists and contains files other than `.git`, `.agents`, `.gemini`, `.editor-config`, and `.DS_Store`. If it is not empty, warn the user in Chinese that files might be overwritten and ask if they wish to proceed. If they approve, append `--force` to the execution command.

## Phase 2: Pipeline (Execution)

Once the user approves the parameters, execute the scaffolding pipeline step-by-step.

### Step 1: Execute the Scaffolder Script

1. Locate the absolute path to this skill's folder on your machine. Let's refer to this as `<SKILL_DIR>`.
2. Run the helper script using Bun. The script automatically clones and pulls the template cache from GitLab (`https://github.com/example-org/liquid-glass-starter.git`) into `~/deploy/`, falling back to the existing cache if offline.
   _Note: The script will automatically run `bun install` at the end to generate the lockfile._

Run command:

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts \
  --name "<PROJECT_NAME>" \
  --target "<TARGET_PATH>" \
  --type "<monorepo|flat-go|flat-java>" \
  --clean-demo <true|false> \
  [--clean-audit-log true] \
  [--clean-notifications true] \
  --db "<monorepo: 仅 drizzle（默认）；flat-go: none|gorm（默认 gorm）；flat-java: none|jpa（默认 jpa）>" \
  [--include-ci true] \
  [--web-apps '<JSON 数组，见下方多端说明>'] \
  [--port <N> | --skip-port-alloc] \
  [--force]
```

_Tier 1 feature stripping policy (audit-log / notification / demo): the script runs the target project's own `scripts/strip-features.ts` (declarative manifest `scripts/features.ts`, template-only files removed afterwards) right after copying the template. It deletes the feature's files, strips its `feature:*` code regions, and unwraps markers of retained features, so **the generated project contains no `feature:*` region markers**. Order: copy → template-only artifacts → flat reorganization → feature stripping → CI stamping → install → `imports:prune` + `eslint --fix` + `prettier --write` (unused imports / formatting left by region removal). The final Prettier pass is **required** for byte-identical `gen:module → remove:module` round-trips: stripped files (e.g. `menu-config.ts`) may otherwise keep non-Prettier-idempotent import layouts that the generator would collapse. No manual regex cleanup is needed in the target project._

_Audit log page policy: for `--type monorepo` the audit-log viewer (page + diff viewer + service/hook + route + menu entry) is kept by default; append `--clean-audit-log true` when the user wants a leaner frontend skeleton. For `flat-go` / `flat-java` the viewer is always removed (those backends only ship `/api/hello`, no `/logs`). The backend audit kernel — `modules/log` (`GET /logs`, `audit:view`), `audit_logs` table and write primitives — is **always retained** (ADR-1)._

_Notification center policy: `--clean-notifications true` removes the notification vertical slice (TopBar bell slot / `NotificationCenter` components / SSE hook / service+hooks / `NotificationsPage` demo / backend `modules/notification` + demo seed + docs). The Tier 0 write kernel (`shared/notification.ts` `notify/notifySafe`, `notification-bus`, `notifications` table) is always retained, so business code keeps compiling unchanged. When omitted in non-TTY runs (CI / piped), it defaults to `false`; when run in a TTY the script asks interactively._

_Only append `--include-ci true` when the user answered Y to question 8. `--include-ci` is only meaningful for `--type monorepo` in this iteration; the script warns and skips CI stamping for flat layouts._

_多端（问题 9 选「多个」）：默认端 `web` 照常生成，其余端用 `--web-apps` 传 JSON 数组，脚本在默认端全部改造完成、`bun install` 之前逐端调**目标项目自己的** `scripts/add-web.ts`（与 `--mode add-web` 完全相同的代码路径）：按 `blank` 逐端选形态——默认克隆该项目的 `apps/web`（改 6 个身份文件 → 补棘轮基线），传 `"blank": true` 时只复制工程底座与样式入口并生成极简空壳（不补棘轮、不剥切片）→ 追加 `web-apps.json` → 可选 `app:<id>` 准入权限（与 blank 互斥）→ Dockerfile 依赖层区块。**技能不再自带端空壳**——端样板就是项目自己的默认端，项目改了它自动跟上。示例：_

```bash
--web-apps '[{"id":"portal","title":"企业服务平台","accessPermission":true},{"id":"public","title":"官网 H5","blank":true}]'
```

> [!IMPORTANT]
> **Windows 上必须改用 `--web-apps-file <path>`**：先把同样内容的 JSON 写进一个临时文件，再传文件路径。cmd.exe 不认单引号且会吃掉内层双引号，PowerShell 5.1 同样丢引号，`--web-apps '<JSON>'` 在这两种 shell 下必然报「不是合法 JSON」。POSIX shell 两种写法都可以。

_`base` 省略即 `/<id>/`，`devPort` 省略即现有端最大值 +1。默认克隆模式的新端逐字节继承默认端（含登录 / 首页 / 404 / 侧边栏布局与全部保留特性），**因此也继承默认端的业务模块切片**：install 之后脚本会对该类新端跑 `remove:module --app <id> --all-modules --force` 剥掉带 `module:*` 区块的切片，并打印继承页面清单供用户确认删留（手写业务页没有区块，不会被自动剥掉）；传 `"blank": true` 时则仅复制工程配置与样式入口、跳过所有 PC 布局与演示页（并跳过切片剥离）。克隆态端加模块用 `gen:module --name <模块> --app <id>`（后端域须已存在）；`--blank` 端不含 `menu-config` 与模块注册锚点，按自建布局写页面即可。_

_When `--include-ci true`, the skill will SSH to the internal test server `deploy@192.0.2.10:2222`, probe LISTEN ports, and allocate the first free port in `11081-11199`. The registry is a single team-shared file at `deploy@192.0.2.10:/srv/deploy/port-registry.json` — atomic reads/writes via remote `flock` + `python3`. Details: see [`references/ci-guide.md` §9](./references/ci-guide.md). Override with `--port <N>`, or skip entirely with `--skip-port-alloc` (keeps template default 11070; user must adjust manually)._

### Step 2: Tailor Configuration & Final Cleanup

Depending on the architecture style chosen:

#### For Style A (Full-stack TS Monorepo):

- Feature stripping already happened inside the script (`scripts/strip-features.ts`): `audit-log` / `notification` / `demo` files are deleted and their `feature:*` regions stripped; retained features have their markers unwrapped. **Do not expect `feature:*` markers in `<TARGET_PATH>`** — if you find any, report it as a template/scaffolder bug.
- If `--clean-demo true` was selected, demo pages are gone and `lib/menu-config.ts` no longer has the Showcase / Templates / System Settings entries; review `<TARGET_PATH>/apps/web/src/App.tsx` and verify the retained routes (`/login`, `/dashboard`, `/settings`, optional `/audit-log`) match `menuGroups`.
- Monorepo clean-demo keeps the real auth loop: `pages/LoginPage.tsx` + the original `@workspace/web-core/router/ProtectedRoute` + startup session restoration in `App.tsx` are retained on purpose (backend seeds an `admin` user). Do **not** remove them unless the generated project intentionally swaps in its own auth.
- Audit log page: kept by default (`<TARGET_PATH>/apps/web/src/pages/audit-log/` + `/audit-log` route + `Admin` menu entry); the backend `/logs` API is never removed. If `--clean-audit-log true` was used, verify the page directory, `components/shared/AuditDiffViewer.tsx`, `lib/audit-diff.ts`, `services/logs.ts`, `hooks/queries/useLogs.ts`, the `/audit-log` route/lazy import and the `logKeys` query key are all gone, while `<TARGET_PATH>/apps/api/src/modules/log/` still exists.
- Notification center: kept by default (TopBar bell + `NotificationCenter` + SSE). If `--clean-notifications true` was used, verify `components/layout/TopBarNotificationSlot.tsx`, `components/shared/Notification*.tsx`, `hooks/queries/useNotification*.ts`, `services/notifications.ts`, `lib/notification-adapter.ts` and `apps/api/src/modules/notification/` are gone, while `apps/api/src/shared/notification.ts` (write kernel) and the `notifications` table in `apps/api/src/db/schema.ts` still exist.
- Unused imports left behind by region removal are auto-pruned and formatted after `bun install` (the script runs `bun run imports:prune -- <files>`, then `eslint --fix`, then `prettier --write` on the strip-modified `.ts/.tsx/.md` files). The Prettier pass makes generated registration files (e.g. `lib/menu-config.ts`) Prettier-idempotent from day one, which is what makes `gen:module → remove:module` byte-identical. If install failed, run those three commands manually (the script prints them).

#### For Style B (Flat Heterogeneous):

- Review `<TARGET_PATH>/frontend/vite.config.ts` and ensure the API proxy targets the correct backend port (e.g., `localhost:8080` for Go/Java).
- Feature stripping for flat layouts rewrites web paths to `--web-root frontend/src`; `apps/api` / `packages` sections of the feature manifest are auto-skipped (those ends do not exist). `<TARGET_PATH>/apps` must not exist.
- If `--clean-demo true` was selected, verify the demo files under `<TARGET_PATH>/frontend/src/pages/` are removed, `<TARGET_PATH>/frontend/src/App.tsx` is simplified (no `/login`; bypass `ProtectedRoute` is expected for flat layouts), and `lib/menu-config.ts` only lists pages that still exist.
- The audit-log frontend page is always removed for flat layouts (no `/logs` backend); verify `<TARGET_PATH>/frontend/src/pages/audit-log/` does not exist.
- Flat post-install cleanup differs from monorepo: `imports:prune` is run as `bun scripts/prune-unused-imports.ts -- <files>` (it resolves TypeScript from `frontend/node_modules/typescript`); root `eslint --fix` is skipped (flat has no root `package.json` / root eslint config — expected hint); `prettier --write` runs **from `frontend/`** with `frontend/node_modules/.bin/prettier` and frontend-relative paths. All three steps are best-effort and never fail the scaffold.
- Flat layout adaptation also relocates `.prettierrc` / `.prettierignore` from the repo root into `frontend/` (and rewrites `tailwindStylesheet` to `./src/index.css`), because flat projects have no root `node_modules` and `prettier-plugin-tailwindcss` is resolved from the working directory. Verify `<TARGET_PATH>/frontend/.prettierrc` exists and `<TARGET_PATH>/.prettierrc` does not.

### Step 3: Git Initialization

The helper script initializes the Git repository and makes the first commit. Verify that a `.gitignore` is present in the target directory and matches the language stack.

---

## 自动化测试边界与手工验收清单

**为什么 scaffold 端到端没有自动化**：完整 scaffold 流程依赖 GitLab 模板 cache（`gh:example-org/...（示例坐标）`）+ `bun install` + 生成 drizzle baseline，三者都无法离线、可重复地复现；这是设计书 §7.2 的已批准偏差（`.team/impl-plan.md` §12.1）。因此 skill 内不包含 `scaffold.test.ts`。但**纯文件操作的 lib 是可测的**：`scripts/lib/skill-sync.ts` 不碰网络、不打印、不退出，已有就近单测并接入 `bun run test:scripts`。

**离线自动化覆盖**（`bun run test:scripts`，无需网络 / 安装依赖）：

- `scripts/strip-features.test.ts`：真实模板 mkdtemp 副本上的单特性 / 组合剥离、flat 布局、report、幂等、原子性、路径防护；`feature:<id>` 标记 ↔ `regionFiles` 清单双向对账；剥离 + `imports:prune` 后「无指向已删模块的 import、无 `feature:*` 残留、整目录删除不被 regionFile 写回复活」的静态检查；demo-only 组合下通知切片保留且不再引用已删 demo 路由。
- `scripts/lib/code-regions.test.ts`：仓库区块完整性扫描（配对合法）。
- `scripts/gen-module.test.ts` / `remove.test.ts`：生成 → 卸载的区块与注册文件往返（依赖真实注册文件副本）；后端域 / 前端切片拆分恒等式、`--app` 切片生成与卸载、全域探测与 `--all-apps` 护栏、`--all-modules` 迭代到不动点、多端往返逐字节还原。
- `scripts/add-web.test.ts`：克隆真实默认端（排除产物）、6 个身份文件正向断言、注册表回读、棘轮 upsert、`web-app:<id>` 区块契约、校验期零副作用、`--json` 跨进程契约。
- `scripts/remove-web.test.ts`：`add:web` → `remove:web` 在临时项目上的有无准入两组逐字节往返、准入配置落在注册表与权限区块、标题转义、棘轮剪枝、反向引用预检（跨端 import / `ROLE_PERMISSIONS` 引用准入码）。两份实现同仓，生成项目也跑全部用例。
- `<SKILL_DIR>/scripts/lib/skill-sync.test.ts`（技能侧，已并入 `test:scripts` 的扫描路径）：空目标全量 added、逐字节一致零差异、单文件改动只进 changed、孤儿进 removed 且同步后物理消失（含空目录清理、技能根保留）、目标目录缺失不抛错、同步幂等、路径含空格与中文。

**必须人工验收的 checklist**（模板变更 / 发版前至少跑一次）：

1. **monorepo 生成项目**：`scaffold --type monorepo` 产物 `bun run check` 全绿（typecheck + lint + migrate:check + arch:check + test）。
2. **特性组合**：分别以 `--clean-notifications true` / `--clean-audit-log true` / `--clean-demo true` 及其组合生成项目，产物 `bun run check` 全绿，且全仓 grep 不到 `feature:*` region 标记；Tier 0 的 `apps/api/src/modules/log/`、`shared/notification.ts` 写入内核、`notifications`/`audit_logs` 表仍在。
3. **gen→remove 往返**：生成项目内 `bun run gen:module --name contract --label "合同" --skip-db` → commit → `bun run remove:module --name contract --skip-db --force` 后，`git status` 只剩 `docs/specs/_archived/`（注册文件逐字节还原——依赖 scaffold 首日写入的 Prettier 幂等形态）。
4. **独立安装 skill**：按官方方式只安装 skill 子树（例如 `npx giget .../tools/scaffolder ~/.claude/tools/scaffolder`）后运行 `bun <skill>/scripts/scaffold.ts`，确认参数校验早退路径与真实初始化路径都不报 `Cannot find module`（scaffold 只 import skill 内部相对路径与 npm 包）。
5. **flat 模板**：`scaffold --type flat-go` 产物 `frontend` 可 `bun install` 且 `tsc --noEmit` 通过；`frontend/.prettierrc` 存在、根 `.prettierrc` 不存在。
6. **多端**：分别生成单端项目与三端项目（`--web-apps` 传两个端，其中一端 `accessPermission: true`），产物各自 `bun run check` 全绿；**同源**形态下（`bun run build:web` + `scripts/collect-web-dist.ts`，API 带 `SERVE_STATIC=true`）同一浏览器里 `/` 与 `/portal/` 各自登录互不影响——开发态各端占不同端口本就不同源，验不出存储键隔离；带准入的端用无该权限的角色登录会被拦在「无权访问本系统」；窄屏真机检查侧边栏收起为 Sheet、刘海 / 底部安全区不遮挡内容。
7. **多端往返与按端模块**：三端项目里 `gen:module --name contract --label "合同"` → `gen:module --name contract --app portal`（后端 5 个注册文件 sha256 不变）→ `remove:module --name contract --app portal`（web / 后端不动）→ `remove:module --name contract --all-apps`；再 `add:web --id admin2 --title "管理端"` → install → `remove:module --app admin2 --all-modules` → `remove:web --id admin2`，`git diff` 零行零脏（含 bun.lock）。

> 修改 `scripts/features.ts` / 区块标注 / `strip-features.ts` 后，至少重跑「离线自动化覆盖」并抽查一项人工 checklist。

---

## Utility: Update Template Cache Only

If the user only wants to refresh the local template cache (e.g., pulling latest changes from GitLab) without scaffolding a new project, run the script with `--update-only`:

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts --update-only
```

This clones (if absent) or pulls (if cached) the template repo into `~/liquid-glass-starter`, **同步本地技能到缓存版本**（见下方协议），then exits immediately. No `--name` or `--target` required.

---

## 技能自更新与重启协议

脚本每次 clone/pull 模板缓存后，会把**正在运行的这份技能**（`<SKILL_DIR>`，运行时由 `import.meta.dir` 上溯一级得到）同步到缓存里的 `tools/scaffolder/`。源就是刚 pull 的缓存，因此技能与它即将使用的模板**严格同源同提交**；不再另跑 giget，也不发额外网络请求。

同步是逐文件内容比对：覆盖改动与新增，**物理删除上游已删的孤儿文件**（例如旧版残留的 `scripts/lib/long-file-ratchet.ts`）并清理空目录。

### 收到退出码 3 时必须做的事

stdout 会出现标记行 `SKILL_UPDATED: re-read SKILL.md and re-run the same command`。此时：

1. **重读 `<SKILL_DIR>/SKILL.md`**——技能文件刚被换掉，流程本身可能已经变了，不能凭记忆里的旧流程继续。
2. 用**完全相同的参数**重跑同一条命令（不要加 `--skip-skill-update`，也不要改参数）。第二遍比对无差异，会正常往下执行。
3. 若本次是 Intent A（新建项目），重跑前**不需要重新 Interview**：参数已确认过，直接复用。

退出码约定：`0` 成功 / `1` 失败 / `3` 技能已更新需重跑。**只有 3 是非失败的非零码。**

### 为什么必须停下来重跑

Bun 启动时已把旧 `scaffold.ts` 读入内存并编译，磁盘上换掉文件不影响本进程。同步后就地继续会变成「旧编排逻辑 + 新 templates/lib」的半新半旧状态，所以脚本选择 `exit 3` 而不是继续。

### 跳过自更新的情形

- 传 `--skip-skill-update`：离线钉版本、或刻意保留本地技能改动时用。
- 直接从模板缓存/仓库里跑脚本（源即目标，含软链接情形）：自动跳过。
- `--mode add-web` / `remove:web`：在 clone/pull **之前**就早退（增删端是纯本地操作，离线无缓存也必须可用），因此不触发自更新。

pull 失败（离线）**不影响**同步：缓存里已有的版本仍可能比本地新，照常比对。

### 首次引导

旧版技能里没有这段同步代码，机制无法自己启动自己。第一次需按 README 的安装命令手动覆盖一次（`npx giget ... --force`），之后自维持。注意 `giget --force` 只覆盖不删孤儿，引导后确认 `scripts/lib/long-file-ratchet.ts` 已消失，若仍在则手动删掉（已无任何代码引用它）。

---

## Utility: 为已有项目添加 CI

当用户意图为“为已有项目加 CI / 流水线 / 部署配置”时，**不要走 Phase 1 Interview**。完整行为契约、对话流程、错误处理均见 [`references/ci-guide.md` §8](./references/ci-guide.md)。

核心命令（确认后执行）：

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts --mode add-ci --target "<TARGET_PATH>" [--port <N> | --skip-port-alloc] [--force]
```

默认会自动 SSH 测试机挖一个空闲端口写死到 compose\*.yml 与 .gitlab-ci.yml（端口段 11081-11199），并推送本机公钥（首次会需要本地安装 sshpass 或 expect，也可先手动跑一次 `ssh-copy-id -p 2222 deploy@192.0.2.10` 后重试）。

---

## Utility: 增删 Web 端

当用户意图为“再加一个端 / 加个企业端 / 加个移动端 / 删掉某个端”时，**不要走 Phase 1 Interview**。只适用于全栈 TS Monorepo（依赖 `packages/ui` + `packages/web-core` + `web-apps.json`），新端一律是同一套 React + Vite，**样板就是目标项目自己的默认端 `apps/web`**。**非 React 前端（uniapp / Taro / 小程序等）不生成**：说明这条边界，由项目按需自带 repo 与构建，只共享后端 API。

### 添加

先问清：**端 id**、**名称**、**端形态**（`克隆默认端` vs `极简空壳 --blank`，后者适合官网 / 独立 H5 / 大屏，无登录无侧边栏且与 `--access-permission` 互斥）、以及默认克隆态是否**限制角色进入**。URL 前缀默认 `/<id>/`、dev 端口自动分配，用户不主动提就不要追问。确认后执行：

```bash
bun run <SKILL_DIR>/scripts/scaffold.ts --mode add-web --target "<TARGET_PATH>" \
  --id portal --title "企业服务平台" [--base /portal/] [--dev-port 5174] [--access-permission | --blank]
```

脚本顺序：参数形状校验（skill 侧纯函数）→ 能力探测（目标项目有 `scripts/add-web.ts` 吗）→ 调目标项目 `scripts/add-web.ts --json`（校验源端完整性与身份改写可命中性 → 克隆默认端排除产物或按 `--blank` 生成极简空壳 → 改 6 个身份文件并正向断言 → 非空壳补棘轮基线 → 追加 `web-apps.json` → 可选注册 `app:<id>`（包在 `web-app:<id>` 区块里）→ Dockerfile 依赖层区块）→ `bun install` → 非 `--blank` 跑 `remove:module --app <id> --all-modules --force` 剥继承切片 → `eslint --fix` + `prettier --write` → `bun run check`。**不读模板缓存、不联网**，离线可用；**add-web 写入期**任一步失败整体回滚（端目录与 4 个注册文件还原，绝不留半成品端）；install / 剥切片 / 门禁失败则**保留端目录**——此时端已成形，`bun run remove:web --id <id>` 是干净撤销路径。

> 项目里也可以直接跑 `bun run add:web --id portal --title "企业服务平台"`（不 install / 不剥切片 / 不跑门禁，末尾打印后续命令）。技能只是这条命令的编排壳。

校验会拒绝：id 不合法 / 撞 `web`、`api` / Windows 保留设备名 / 已存在；`base` 为 `/`、占用 `/api/`、与默认端已有一级路由同名（例如默认端已有 `/portal` 页面）、与其他端重复；devPort 撞已有端或撞 API 的 3000；`--blank` 与 `--access-permission` 同时传入；默认端缺关键文件；身份改写点命中数不等于 1。失败时**零副作用**，改参数重跑即可。

成功后必须向用户交代：dev 地址 `http://localhost:<devPort><base>`、生产是**同源子路径**（由 API 静态托管，不需要额外容器 / 端口 / nginx）。默认克隆态还需交代：**继承页面清单**（脚本会打印，手写业务页没有 `module:*` 区块不会被自动剥掉，需用户确认删留）、给本端加业务模块用 `bun run gen:module --name <模块> --label "<中文名>" --app <id>`（后端域须已存在，否则先裸跑一次建域）、样板自带侧边栏与移动端底部 `MobileTabBar`/安全区让位；若传了 `--blank`，则端内仅保留工程底座与触屏样式基线、不含登录与侧边栏，按官网 / 独立 H5 / 大屏自建布局即可。选了限制准入的，还要说明 admin 自动持有 `app:<id>`，其他角色需在 `packages/shared/src/permissions.ts` 的 `ROLE_PERMISSIONS` 里加 `PERMISSIONS.APP_<ID 大写下划线>`，且**端准入只是体验层（经 `VITE_APP_ACCESS_PERMISSION` 注入、由各端 SidebarLayout 拦截），接口鉴权仍靠后端 `requirePermission`**。

### 删除

删除脚本在**目标项目内**（不依赖 skill）：

```bash
cd <TARGET_PATH> && bun run remove:web --id portal [--dry-run] [--force] [--skip-install]
```

删 `apps/portal` → 移除注册表条目 → `stripRegions` 剥掉 `web-app:portal` 区块（权限码 / Dockerfile 依赖层）→ 剪掉失效的 450 行棘轮条目 → `bun install`。默认端 `web` 不可删除。删除前做反向引用预检：其他端 / 共享包 import 本端，或 `app:<id>` 仍被 `ROLE_PERMISSIONS` 等区块外代码引用 → 终止并列出位置，先解引用再删。

---

## Error Handling & Self-Correction

If the `scaffold.ts` script exits with a non-zero exit code, analyze the stderr log and self-correct:

- **"Error: Target directory is not empty..."**: Prompt the user in Chinese that the directory has files, ask if they want to overwrite, and if they confirm, rerun the command adding the `--force` flag.
- **"Failed to clone template from GitLab..."**: Inform the user in Chinese that the script could not connect to the internal GitLab IP and there is no cached template available on this machine yet. Suggest checking their VPN or network connection to the internal server.
- **Add-CI 相关错误** (`CI files already exist` / `Project structure does not match...` / `Flat layout CI is not sedimented`)：见 [`references/ci-guide.md` §8.4](./references/ci-guide.md)。
- **Add-web 相关错误**（`base ... 与默认端的一级路由 ... 冲突` / `devPort ... 重复` / `缺少锚点` / `默认端缺少 apps/web/...` / `改写点命中 N 处`）：校验期失败零副作用，按提示换一个 id / base / 端口重跑；提示缺锚点时先跑 `--mode add-ci --force` 刷新 CI 文件；提示改写点命中数不对说明默认端形态被手改过，先修默认端再增端。
- **`目标项目缺少 scripts/add-web.ts` 或提示不支持 `--blank`**：目标项目是旧版脚手架产物。**不要静默降级回技能自造空壳**——说明需要升级，让用户用最新模板重新生成，或从模板仓库补齐/更新 `scripts/add-web.ts` 后重试。
- **`--all-modules` 被反向引用阻塞**：新端继承的切片在区块外仍被引用（多半是默认端手写的页面引了某模块的 service）。按报错列出的位置解引用后补跑 `bun run remove:module --app <id> --all-modules --force`；端已成形，整体撤销用 `bun run remove:web --id <id>`。
- `bun run check` 失败时端文件已保留，修完重跑门禁即可，不必删端重来。

---

## Gotchas

- **Cross-platform compatibility**: The helper script uses cross-platform Node/Bun APIs. Always invoke it using `bun run` as Bun is installed in the environment.
- **Path escaping**: Ensure target paths are fully resolved absolute paths (no relative `../`).
- **OpenAPI contracts**: Remind the user that for heterogeneous architectures, they should use OpenAPI/Swagger to generate TypeScript types for the frontend instead of directly sharing types via Monorepo.

---

## Success Output Template (in Chinese)

After the pipeline completes successfully, output the result in Chinese showing the generated directory structure and instructions on how to start the project.

Example output:

```markdown
🎉 **项目初始化成功！**

您的项目已成功生成在：`<TARGET_PATH>`

### 📂 目录结构

[显示生成的树状目录结构]

### 🚀 快速启动

1. 进入项目根目录：`cd <TARGET_PATH>`
2. 启动开发服务器：
   - 全栈 TS: `bun run dev`
   - 异构结构: `task dev` (需要安装 go-task: `brew install go-task`)

### 🎨 自定义设计

- 编辑 `packages/ui/src/theme-tokens.css` 自定义主色调。
- API 服务契约可在 `services/` 目录下完成对接。
```

### Post-Success Additions

- **当未注入 CI 时**：在成功输出末尾补一句提示——“当项目稳定后需要 CI/CD 时，可随时向 AI 说明‘为此项目加 CI’来追加配置。”
- **当已注入 CI 时**（init 带 `--include-ci true` 或 add-ci 成功）：在成功输出末尾追加“GitLab CI 上线清单”小节，列出必配变量（从 `references/ci-guide.md` 的“GitLab CI/CD Variables”章节提取）及首次触发方式（push main / GitLab Web UI / CI/CD Schedules）。
