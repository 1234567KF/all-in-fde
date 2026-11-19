# AI Developer Guide

This project is AI-Native. Follow these guidelines when modifying or creating components and pages.

## Design System

- **MUST read and follow** the [DESIGN.md](./DESIGN.md) specification for all visual tokens, colors, typography, layout grid, glassmorphism, responsive styles, animations, and structural page/dialog/table layout rules.
- **Never hardcode colors** (`hex` / `rgba` / Tailwind 原色类)。用 `variant="destructive"` 或主题变量（`style={{ color: "var(--lg-danger)" }}`），token 见 [theme-tokens.css](packages/ui/src/theme-tokens.css) / [design-utils.css](packages/ui/src/design-utils.css)。主题色通过 `theme-tokens.css` 的 `--theme-*` 种子与 `[data-theme-color]` 预设块切换，**语义状态色（success/danger/warning/info）不跟随主题色**。
- **主题色入口**：顶栏 Palette 面板与个人设置页共用 [ThemeColorPicker](packages/ui/src/components/shared/ThemeColorPicker.tsx)；色板元数据在 [theme-colors.ts](packages/ui/src/lib/theme-colors.ts)。新增预设步骤见 README「切换主题色」。

## Key Files

[theme-tokens.css](packages/ui/src/theme-tokens.css) Design tokens · [theme-colors.ts](packages/ui/src/lib/theme-colors.ts) Theme color presets · [design-utils.css](packages/ui/src/design-utils.css) Glass utilities · [menu-config.ts](apps/web/src/lib/menu-config.ts) Sidebar & ⌘K index · [App.tsx](apps/web/src/App.tsx) Main Router · [schema.ts](apps/api/src/db/schema.ts) Database Schema · [shared/src](packages/shared/src) Shared Schemas & TS Types · [web-apps.json](web-apps.json) 端注册表

## 前端分包与依赖方向

前端源码分三层，**写代码前先确认文件该落在哪一层**：

| 包 / 目录             | 收纳                                                                                                                                                                                                                                 | 判据                                       |
| :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- |
| `@workspace/ui`       | `components/ui/*`（shadcn 原语）、Tier 0 通用组件（DataTable / ResponsiveDialog / FilterBar / ConfirmDialog…）、`theme-provider`、`use-mobile`、`lib/{utils,theme-colors,date-utils,format}`、`theme-tokens.css`、`design-utils.css` | 不依赖网络、不依赖 store，只靠 props 驱动  |
| `@workspace/web-core` | `lib/{api,query,toast,errors,app-scope}`、`stores/auth`、`services/auth`、`usePermission`、`PermissionGate`、`ProtectedRoute`                                                                                                        | 任何端都要的「登录 + 请求 + 权限」最小闭环 |
| `apps/<id>/src`       | 业务 `services/*`、`hooks/queries/*`、`query-keys`、Tier 1 特性组件、layout、全部 pages                                                                                                                                              | 归属单端（可选特性的剥离单元）             |

- **依赖方向**：`apps/* → web-core → shared`、`apps/* → ui`；**`ui` 不得 import `web-core`**（ESLint `no-restricted-imports`），各端之间禁止互相 import、共享包不得 import 某个端的源码（`arch:check` 的 `no-cross-app-import`）。
- **提升规则**：某个业务切片**第二次**被另一个端使用时，才把它从 `apps/<id>` 提升到共享包。在那之前不做预先抽象。
- 两个包都**直接引用源码、无 build 步骤**：`package.json` 的 `exports` 通配指向 `src/*.tsx` / `src/*.ts`，宿主只声明 `"@workspace/ui": "*"` 依赖即可，不需要额外 alias。
- 宿主 CSS 必须 `@import "@workspace/ui/theme-tokens.css"` 并写 `@source "../../../packages/ui/src"`——Tailwind v4 只自动扫描宿主目录，漏了 `@source` 会让共享包里的 class 全部不生成。
- 新增 shadcn 组件在 `packages/ui` 下执行（该包自带 `components.json`）；宿主 `apps/<id>/components.json` 的 `ui` / `utils` 别名已指向 `@workspace/ui/*`。

## 多 Web 端

端注册表 [web-apps.json](web-apps.json) 是唯一事实源：`id`（= 目录名 = workspace 包名）、`base`、`devPort`、`title`、可选 `accessPermission`。默认端固定 `web` + `base: "/"`。dev / build / typecheck / lint / test 全部由 `scripts/run-web-task.ts` 遍历注册表，**新增端不需要改根脚本、CI、compose 或端口映射**（所有端同源同端口，只是 URL 前缀不同）。

- **增端**：`bun run add:web --id portal --title "企业服务平台" [--base /portal/] [--dev-port N] [--access-permission | --blank] [--dry-run]`。**端样板就是本项目自己的默认端 `apps/web`**：递归克隆（排除产物）→ 改 6 个身份文件（vite `APP_ID` / vitest `readWebApp` / package.json `name` / tsconfig `tsBuildInfoFile` / index.html `title` / app-config 三常量）→ 补棘轮基线 → 追加注册表 → 可选注册 `app:<id>` → Dockerfile 依赖层区块；追加 `--blank` 时保留工程底座与样式入口但跳过全部 PC 布局/登录/演示页面与棘轮（改生成极简 `HomePage` + `NotFoundPage`，与 `--access-permission` 互斥，适合官网 / 独立 H5 / 大屏）。刻意不 install / 不剥业务 / 不跑门禁，CLI 末尾打印后续命令。技能入口 `bun <skill>/scripts/scaffold.ts --mode add-web --target . --id … --title … [--blank]` 只做参数校验与编排（install → `remove:module --app <id> --all-modules` → 格式化 → `bun run check`），新建项目时的多端（`--web-apps`，Windows 用 `--web-apps-file` 传 JSON 文件）走同一条代码路径。**增删端都在项目侧**，技能不再自带端空壳。
- **删端**：`bun run remove:web --id portal`（`--dry-run` / `--force` / `--skip-install`）。删目录 → 移条目 → `stripRegions` 剥 `web-app:portal` → 剪棘轮 → install。默认端 `web` 不可删；删除前预检跨端 import 与 `ROLE_PERMISSIONS` 对准入码的引用。
- **`web-app:<id>` 区块与 `[web-apps:dockerfile]` 锚点勿手改**：它们是 `add:web` / `remove:web` 的归属声明，与 `[gen:module:*]` 同级维护。区块语法由 `scripts/lib/code-regions.ts` 解析（Dockerfile 用 `#` 宿主语法）。
- **端准入只是体验层**：注册表的 `accessPermission` 经各端 vite `define` 注入 `VITE_APP_ACCESS_PERMISSION`，由 `src/layouts/SidebarLayout.tsx` 用 `usePermission().can` 判断后渲染「无权访问本系统」——**克隆出的新端自动继承，不需要改端内代码**。真正的越权防线仍是后端各路由的 `requirePermission`。admin 通过 `ALL_PERMISSIONS` 自动持有，其他角色需手工加进 `ROLE_PERMISSIONS`。
- **登录状态按端隔离**：auth 存储键默认端仍是 `auth-storage`，其他端 `auth-storage:<id>`；主题偏好刻意跨端共享。
- **只有一种 React 工程底座 = 默认端**：所有 `add:web` 派生的端都是 React + Vite（继承 `viewport-fit=cover`、触屏基线 CSS 与 `@workspace/ui` 设计系统）；其中默认克隆模式继承登录 / 首页 / 404 / 侧边栏布局 / 移动端底部 `MobileTabBar`（适合内部后台或门户），而 `--blank` 模式仅保留工程底座并生成无登录、无侧边栏的极简空壳（适合官网 / 独立 H5 / 大屏，无需再手动清理 PC 模板）。**非 React 前端（uniapp / Taro / 小程序等）不由脚手架生成**，项目按需自带 repo 与构建，只共享后端 API。
- **克隆的代价**：端内的 Tier 1 特性组件会在各端各存一份，改一个 bug 要改 N 处。按上面的提升规则，第二次被别端使用时触发条件立刻成立——但是否真要**共享同一份行为**得看真实消费者，`add:web` 只打印继承清单让团队有意识地决定，不做预先抽象。手写业务页没有 `module:*` 区块，不会被 `--all-modules` 剥掉，需人工确认删留。

<!-- region:template-only -->

## 模板仓库专属规则（scaffold 生成项目会剥离本段）

- **本仓库是脚手架模板本身，部署级别无状态**：self-deploy 用 [compose.self.yml](compose.self.yml)（`/app/data` 挂 tmpfs，容器重建即空库；空库执行 `init.sql` 时自动补齐 7 条演示通知，生成项目走 drizzle 迁移不会种）。生成项目用 `compose.test.yml` 的 `./data` 持久卷，不受本规则影响。
- **预发布形态只属于生成项目**：[compose.preprod.yml](compose.preprod.yml) 是 `./data` 持久卷 + 外网机从 Registry 拉取，模板自身**不启用**（`PREPROD_HOST` 保持 `REPLACE_ME`），否则违反上一条无状态规则。启用方式与外网机准备见 [ci-guide.md §10](tools/scaffolder/references/ci-guide.md)。
- **模板不提交迁移脚本**：数据库结构唯一来源是 [schema.ts](apps/api/src/db/schema.ts)，生成单份 [init.sql](apps/api/init.sql)。修改 schema 后运行 `bun --filter api db:init:generate`；禁止在模板里 `db:generate`（守卫会拒绝）。
- **生成项目相反**：scaffold 会删除 `init.sql` 并生成 drizzle baseline，此后用 `bun --filter api db:generate` / `bun --filter api db:migrate` 正常升级。
- 模板 `migrate:check` 校验 `init.sql` 与 `schema.ts` 一致；生成项目 `migrate:check` 校验迁移 journal/snapshot/drift。
- **450 行棘轮白名单与脚手架联动**：`scripts/arch-check.ts` 的 `LONG_FILE_RATCHET` 按模板 demo 页路径写死；scaffold 在 `--clean-demo` 删页、`--include-ci` / `--mode add-ci` 用模板原件覆盖 arch-check 后，会调用 `pruneMissingLongFileRatchet()` 按目标项目实际文件剪掉失效条目，否则生成项目跑 `bun run arch:check` 会报 `overlong-ratchet-missing`。`add:web` 反过来用 `upsertLongFileRatchetEntries()` 给克隆端补基线（已存在的 key 取较小值，只许减不许增）。增删白名单条目不需要改 scaffold 的文件清单；但 helper 依赖 `const LONG_FILE_RATCHET` 字面量与 `"<相对路径>": <行数>,` 的单行条目格式，改动这两个形态需同步更新 helper。

<!-- endregion:template-only -->

## Add a New Page

1. **Create**: New component under `apps/<id>/src/pages/`（默认端是 `apps/web`；Tailwind CSS）
2. **Route**: Lazy-load via `React.lazy`（所有页面强制，LoginPage 除外），register in that app's [App.tsx](apps/web/src/App.tsx) inside `<Route element={<SidebarLayout />}>`
3. **Nav**: Add entry to `menuGroups` in that app's [menu-config.ts](apps/web/src/lib/menu-config.ts) (`title` / `path` / `icon` / `keywords` / `englishSub`；需要按权限隐藏时加 `permission: PERMISSIONS.X`，不填默认全员可见)

<!-- region:api -->

## API & Service Layer

- **业务模块一键生成**：`bun run gen:module --name contract --label "合同" --icon FileText`（加 `--mode sortable` 生成字典/拖拽重排模块）。一条命令生成 5 要素骨架（shared 契约 / 后端 service+route+测试 / 前端 service+hooks+页面+表单 + `docs/specs/<name>.md` 规格书）并自动注册权限码、审计模块、导出、表结构、API 挂载、query key、`App.tsx` 懒加载路由与菜单项；配合 [business-feature-builder](.agents/skills/business-feature-builder/SKILL.md) 技能、复杂业务进阶范式 [advanced-patterns.md](.agents/skills/business-feature-builder/references/advanced-patterns.md)、5 要素规格书模板 [docs/specs/\_template.md](docs/specs/_template.md) 与人机协同手册 [WORKFLOW.md](./WORKFLOW.md) 对齐需求、替换占位字段并跑门禁。注册位置由源码里的 `[gen:module:*]` 注释锚点定位，**勿删改锚点**；改生成器 / 锚点后跑 `bun run test:scripts`（含真实锚点断言）与 `bun run gen:module --name contract --label "合同" --dry-run` 自检。
- **业务模块对称卸载**：`bun run remove:module --name contract`（等价 `gen:module --remove`）。删除模块专属文件（shared 契约 / api service+route+测试 / web service+hooks+页面 / 规格书）并剥离注册文件里的 `module:<name>` 区块（后端/共享 5 个 + 每个含该模块切片的端 3 个），随后自动 `imports:prune` + 格式化；执行前做**反向引用预检**（外键、`PERMISSIONS.<UPPER>_`、`<camel>Keys`、shared 导出符号等），命中即终止并列出位置。常用选项：`--dry-run`（只打印计划）、`--purge-spec`（物理删除规格书，默认归档到 `docs/specs/_archived/`）、`--force`（允许相关文件有未提交改动）、`--skip-format` / `--skip-db`。生成项目**永不自动生成 DROP TABLE 迁移**，只打印人工审核提示；`LONG_FILE_RATCHET` 会由 `pruneMissingLongFileRatchet()` 自动剪枝。
- **后端域 vs 前端切片（多端生命周期）**：一个模块的**后端域**（shared 契约 / Drizzle 表 / service+route / 权限码 / 审计标签 / 规格书）只注册一次；**前端切片**（pages / services / hooks / query-keys / 路由 / 菜单）按端生成与卸载。

  | 命令                                       | 后端域                    | 前端切片       | 规格书 / DB |
  | :----------------------------------------- | :------------------------ | :------------- | :---------- |
  | `gen:module --name X --label …`            | 创建                      | 仅 `web`       | 创建 / 同步 |
  | `gen:module --name X --app portal`         | **必须已存在**，否则报错  | 仅 portal      | 不动 / 跳过 |
  | `remove:module --name X --app portal`      | 不动                      | 仅 portal      | 不动 / 跳过 |
  | `remove:module --name X`（多端有切片）     | 删除，**需 `--all-apps`** | 探测到的所有端 | 归档 / 同步 |
  | `remove:module --app portal --all-modules` | 不动                      | portal 全部    | 不动 / 跳过 |

  `--app` 时 `label` / `icon` 缺省沿用后端域（可按端覆盖，只影响本端文案与菜单），`mode` 不一致直接报错。`--all-modules` 必须与 `--app` 同时使用，按 `module:*` 区块枚举并迭代到不动点（跨模块引用也能拆干净），探测到 0 个模块静默成功——这是 `add:web` 的清场入口。切片模式的反向引用预检只查 4 条前端特征（`@/pages/<name>/` / `@/services/<name>` / `use<P>` / `<camel>Keys`），不会因为保留的后端域符号误报。

- **代码区块（`#region`）不可手删**：`gen:module` 写入的 `// #region module:<name>` … `// #endregion module:<name>` 与 `// #region gen:group:Business` 容器、以及 Tier 1 的 `feature:<id>` 区块，是「区块内代码归该模块/特性所有」的**唯一归属声明**，与 `[gen:module:*]` 锚点同级维护：**勿删改标记行、勿把非本模块代码写进他人区块**。区块内可自由修改；区块外新增对该模块的引用会被 `remove:module` 预检拦截。区块语法由 `scripts/lib/code-regions.ts` 统一解析（TS / JSX / Markdown / dotenv 四种宿主语法），`bun run test:scripts` 会扫描全仓 `apps/`、`packages/`、`AGENTS.md`、`README.md`、`.agents/skills/`、`docs/specs/` 校验配对合法，破坏标记即 CI 失败。
- **业务规格书读写纪律（改前必读、按需更新）**：修改或修复任何业务模块（`apps/api/src/modules/<name>` / `apps/web/src/pages/<name>`）前，若存在 `docs/specs/<name>.md` **必须先读取**以核对业务不变量，防止修 A 破 B。**何时改 Spec**：仅当五要素本身发生变化（字段/枚举、接口契约、业务拦截规则、交互功能块、权限/审计）或修 Bug 时发现原 Spec 遗漏了业务边界时，才同步更新 `docs/specs/<name>.md` 及 `0.2 版本演进记录`；**纯代码实现缺陷修复（使代码符合既有 Spec）、UI 样式微调、性能优化或组件拆分重构，均不修改 Spec、不刷版本号**。收到用户提供的原始 PRD / 原型 HTML 时，自动归档至 `docs/requirements/v<X.Y>/`。
- **No direct imports** of `api` (`@workspace/web-core/lib/api`), `fetch`, `axios`, or backend RPC clients in UI components. Network logic in `apps/web/src/services/`.
- **后端模块化**：`apps/api/src/modules/<domain>/` 含 `.route.ts`（薄 handler）+ `.service.ts`（业务 + 审计）。参考活教材：[modules/user](apps/api/src/modules/user/) · [modules/auth](apps/api/src/modules/auth/)；只读查询参考 [modules/log](apps/api/src/modules/log/)（`GET /logs` 审计日志，service 负责 SQL 而不接 OpCtx——B2 门禁同样禁止只读 route 直连 DB）。
- **Service 约定**：写操作与写审计的函数首参 `OpCtx`（`opCtxMiddleware` 在 authMiddleware 后统一注入，handler 用 `c.get("opCtx")` 获取）；纯只读查询（如 `getMe(email)`）不写审计，不必接。抛领域错误 `ServiceError`，handler 用 `mapServiceError` 转 HTTP。
- **try/catch 约定**：只读且无业务分支的 handler 可省略 try/catch（全局 onError 兜底）；写操作或含业务判断的 handler 必须 try/catch + `mapServiceError`。
- **审计日志**：CRUD → `auditedInsert/Update/Delete` + `TableAuditConfig`（内联在 service）；非 CRUD → `createAuditor(module)`。禁止裸调 `writeLog`。只读查询 API 见 [modules/log](apps/api/src/modules/log/)（`GET /logs`，需 `audit:view`，不提供客户端写入口）。**未认证入口**只挂 `opCtxMiddleware`（不挂 authMiddleware）拿壳 OpCtx，再 `audit({ ...ctx, operator, ... })` 覆盖身份；ip/ua/requestId 随 `...ctx` 整体带入，**禁止手工逐字段拼装**。身份取值规则与写法示例见 [modules/auth](apps/api/src/modules/auth/) 文件头及 [no-audit-fn-without-opctx](eslint-rules/no-audit-fn-without-opctx.js) JSDoc。
- **权限体系**：权限码唯一事实源是 [permissions.ts](packages/shared/src/permissions.ts) 的 `PERMISSION_REGISTRY`（`resource:action` 命名 + `PermissionCode` 类型），新增权限只需注册表加一条。路由级默认用 `requirePermission(...codes)` 中间件；资源级、字段级或依赖业务状态的授权由 service 领域方法表达，不要求硬塞进中间件。handler 原则上不手写 `if (!hasPermission(...))`，确需动态判断的例外必须 `eslint-disable-next-line` 并附理由。登录与 `GET/PUT /users/me` 用 `permissionsForRole(role)` 把角色解析成 `permissions: string[]` 随 user 下发——这是前端唯一的权限数据源；DB role 为 NULL 时按 `DEFAULT_ROLE`（user）解析，与 JWT 签发兜底同源。
- **认证（薄模块，可替换）**：默认账号 + bcrypt 密码（`users.password_hash`；空 hash = 该用户禁用密码登录）。登录校验集中在 [auth.service.ts](apps/api/src/modules/auth/auth.service.ts) 的 `findUserByIdentifier` / `verifyCredential` 两个替换点，JWT 签发 / 审计 / 权限保持不变；production 必须配置 ≥6 位的 `SEED_ADMIN_PASSWORD`（缺省 / 过短 / `.env.example` 占位值会被启动守卫拒绝）；扩展手机号、短信验证码、企业 SSO 与「同一用户多种登录方式」的升级路径见 [docs/auth.md](docs/auth.md)。
- **共享基础设施** `apps/api/src/shared/`：audited-crud · audit-log · op-context · service-error · logger · notification（通用消息内核）· notification-bus · oss（对象存储双模）· sqlite-ops（SQLite 统计 / VACUUM / 热备）

<!-- region:feature:notification -->

- **消息通知内核（业务无关）**：业务只调 `notify() / notifyMany() / notifySafe()`（[shared/notification.ts](apps/api/src/shared/notification.ts)），不要自己 insert `notifications` 表。`type` 是不透明字符串（不建枚举、不写 shared 常量表）、`payload` 承载业务字段；收件人只从 JWT 取。已读/删除是用户自有高频状态，**不写审计**（`notification.service.ts` 头注释有理由）；清理类批量操作另行审计。SSE 用 `Authorization: Bearer` + fetch 流，禁止把 token 放 query string。wire→view 映射唯一入口是 [notification-adapter.ts](apps/web/src/lib/notification-adapter.ts)。演示数据由建库来源决定：模板空库走 `init.sql` 时自动种 7 条演示通知，生成项目走 drizzle 迁移不会种。

<!-- endregion:feature:notification -->

- **对象存储与 SQLite 运维工具箱（零表依赖，不写审计）**：上传 / 下载统一走 [shared/oss.ts](apps/api/src/shared/oss.ts)，禁止业务直接 import `ali-oss`（ESLint `no-restricted-imports` 门禁，静态 / re-export / 动态 import() 均拦截）；`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` 同时配置才启用 OSS 模式，否则降级本地 mock，mock 的本地回退路由由业务方传入（`MockOssRoutes`），上传上限统一读 `UPLOAD_MAX_SIZE_MB`。数据库统计 / 优化 / 备份走 [shared/sqlite-ops.ts](apps/api/src/shared/sqlite-ops.ts)（`getSqliteStats` / `runSqliteVacuum` / `createSqliteBackup`，`VACUUM INTO` 快照 + 本地或 OSS 轮转）；是否审计、谁能触发由调用方 service 决定。危险操作前端确认统一用 `DangerZoneGroup`。
- **Database**: Drizzle ORM + `bun:sqlite`。Schema 唯一事实源 [db/schema.ts](apps/api/src/db/schema.ts)，首次数据库访问时（惰性初始化）由 [db/bootstrap.ts](apps/api/src/db/bootstrap.ts) 自动识别并应用 `apps/api/drizzle/` 迁移。修改 schema 后运行 `bun --filter api db:generate` 生成迁移并提交（journal / snapshot 必须配对）；本地重建用 `bun run db:reset`。
- Request/response schemas in `packages/shared/src/`, shared between frontend & backend.

<!-- endregion:api -->

## State Management

- **Server state goes through TanStack Query hooks** in `apps/web/src/hooks/queries/` (query keys in [query-keys.ts](apps/web/src/lib/query-keys.ts), client config in [query.ts](packages/web-core/src/lib/query.ts)). Do not put server data in Zustand; invalidate the domain key after mutations instead of manual refetch.
- **Zustand** 只放 auth 与 UI/客户端状态：`auth` 在 [web-core/stores/auth.ts](packages/web-core/src/stores/auth.ts)（各端共用，存储键按端隔离），端内 UI 状态放 `apps/<id>/src/stores/`（默认端的 `layoutStore`）。
- **前端权限消费**：只读 auth store 中的 `user.permissions: string[]`（登录成功时写入；`GET /users/me` 同样返回但不回写 store；refresh 只旋转 token、不刷新角色）。禁止前端 import `ROLE_PERMISSIONS` / `ALL_PERMISSIONS` / `permissionsForRole` 自行推导角色。按钮/区块显隐用 `usePermission().can/canAny` 或 `<PermissionGate perm={PERMISSIONS.X}>`；`menu-config.ts` 的 `MenuItem.permission` 不填默认全员可见、填了由侧边栏与 ⌘K 自动过滤；面包屑用 `getBreadcrumbs(pathname)` 纯路径派生（与权限解耦）。导航隐藏 ≠ 鉴权，页面/接口仍由后端 `requirePermission` 把关。
- **客户端列表分页**用 `usePagedList`（`@/hooks/usePagedList`，过滤+排序+分页组合）；服务端分页走 Query hooks + API 参数。
- 避免 selector 内的派生状态计算触发重渲染。用 `useMemo` 或提取到组件外。

## 架构门禁（CI check 阶段阻断）

分工：**能用 AST 判定的走 ESLint（自定义规则在 `eslint-rules/`，`bun run lint` 覆盖 `apps/*` + `packages/*` + api）；跨文件不变量才留给 `bun run arch:check`（扫 `apps/<每个注册端>/src` + `packages/ui/src` + `packages/web-core/src`）**。

- `no-toisostring-slice`：禁止 `.toISOString().slice/split(...)` 截日期（UTC+ 时区会前移一天），用 `formatDate`（`@workspace/ui/lib/date-utils`）。
- `no-tailwind-raw-colors`：全部前端 `.tsx`（`apps/*/src/**` + `packages/ui/src/**` + `packages/web-core/src/**`，含 App.tsx / layouts / router）禁用 Tailwind 原色类（`text-red-500` 等），以及 JSX 内联 `style` 中的硬编码颜色字面量（`#hex` / `rgb()` / `hsl()`，函数名大小写不敏感）；用语义化 token 或 `color-mix(...)`。token 混入字面量（如 `linear-gradient(var(--a), #fff)`）同样报错，`rgba(var(--*-rgb), α)` 这类分量全部来自 token 的组合放行。
- `no-service-import-in-ui`：pages/components（含两个共享包的 `components/`）禁止值导入 `@/services/*` 与 `@workspace/web-core/services/*`（type-only 允许），服务端数据走 `hooks/queries/`。
- `no-raw-viewport-check`：pages/components 禁止直读 `window.innerWidth`——结构分叉用 `useIsMobile()`（`@workspace/ui/hooks/use-mobile`），样式差异用 Tailwind 断点类，触摸检测用 `pointer-coarse:`。
- `no-audit-fn-without-opctx`：`modules/**/*.service.ts` 中直接写审计（调用 `audit` / `auditedInsert|Update|Delete`）的**导出**函数，首参必须标注 `OpCtx`；只防常见签名漂移，不保证间接审计与身份字段完整。
- `no-restricted-syntax`：`modules/**/*.ts` 禁裸调 `writeLog(`；`*.route.ts` 默认禁手写 `hasPermission(`，资源级、字段级及业务状态相关的动态授权不受此限，handler 例外须带理由豁免。
- `no-restricted-imports` + `no-restricted-syntax`：`*.route.ts` 禁止直连数据库——静态 import / re-export / 动态 `import()` 均拦截 `**/db*`、`drizzle-orm`、`bun:sqlite`；查询/写入与业务规则必须下沉到同模块 `*.service.ts`。
- `no-restricted-imports` + `no-restricted-syntax`（api）：`apps/api/src/modules/**` 禁止直连 `ali-oss`（静态 / re-export / 动态 `import()` 均拦截），对象存储统一走 `shared/oss.ts` 双模封装；模块测试文件放行（允许 mock SDK）。断言见 `eslint-rules/api-oss-import-guard.test.js`。
- `no-restricted-imports`（前端）：`apps/*/src/**` + `packages/ui/src/**` + `packages/web-core/src/**` 禁止 import `ROLE_PERMISSIONS` / `ALL_PERMISSIONS` / `permissionsForRole` 自行推导权限，前端只消费 wire 下发的 `user.permissions`（`usePermission` / `PermissionGate`）。盲区：namespace import（`import * as shared`）不受 `importNames` 约束，靠评审兜底。
- `no-restricted-imports`（依赖方向）：`packages/ui/src/**` 禁止 import `@workspace/web-core` / `@workspace/web-core/*`——ui 层只靠 props 驱动，不得反向依赖内核。注意 flat config 对同一 rule key 整体覆盖而非合并，新增前端配置块必须重复带上 `paths`。
- `arch:check`：页面必须在各端 `App.tsx` 里 `React.lazy`（跨文件，ESLint 单文件扫不到）；UI 层禁 `@workspace/web-core/lib/api` / `@/lib/api` / axios / sonner 直连；**各 `apps/*` 之间禁止互相 import**（`no-cross-app-import`，相对路径与裸包名两种写法都查）；**端身份不变量**（`web-app-identity-mismatch`：逐注册端断言 package.json `name`、vite `APP_ID`、vitest `readWebApp` 的 id、tsconfig `tsBuildInfoFile` 文件名四项都等于端 id——漏改任一项都会静默串端）；单文件行数棘轮（各端 pages 下 `.tsx` + `apps/api/src/modules/**/*.ts`，硬上限 450 行、口径同 `wc -l`；存量超长文件列入 `LONG_FILE_RATCHET`，高于基线或低于基线未下调都报错——只许减不许增）；业务模块规格书存在性守护（`apps/api/src/modules/<name>` 排除内置 `auth`/`user`/`log`/`notification` 后，必须存在对应的 `docs/specs/<name>.md`）。
- 豁免：`// eslint-disable-next-line <rule-id> -- <理由>`；未使用的 disable 会报错，修好后必须删。文件级永久豁免走 `eslint.config.js` 的 `files:` + `"rule": "off"` 块并附理由。
- **改规则前先读** `eslint-rules/*.js` 的 JSDoc 与 `eslint.config.js` 注释——判据、盲区、设计理由都在那里，不在本文件。

## Shared Components

通用组件在 `@workspace/ui/components/shared/*`（props 驱动，各端共用）：

- `DataTable` 数据表格 (`mobileCard` renders card list on <md, drag reorder supported)
- `MobileCard` mobile card content primitives (Header/Body/Footer 三段式 + Compact)
- `StatusBadge` 启用/停用徽章
- `ThemeColorPicker` 主题色选择器
- `ResponsiveDialog` desktop Dialog / mobile bottom Sheet
- `DetailRow`
- `SectionCard`
- `NullableText`
- `DateCell`
- `VirtualDataTable` virtual scroll (1000+ rows)
- `ConfirmDialog` 确认弹窗
- `FileUpload` 拖拽上传
- `PageSkeleton` 骨架屏
- `FilterBar` filter toolbar (mobile: collapses into bottom-sheet via `search`/`sheetLabels`/`activeFilterCount`)
- `SmartPagination` 分页
- `DangerZone` 危险操作分组卡（二次确认 + 可选密码透传 + 执行中 loading 锁）
- `MobileTabBar` 移动端底部一级导航（props 驱动：`items` 传入 + 「菜单」格唤起侧边抽屉；桌面不渲染）

端内组件留在 `apps/web/src/components/shared/*`（端内可复用即留此层，零端内依赖的纯展示组件也一样——可选特性按端剥离，共享包文件没有端归属）：

- `CommandPalette` ⌘K

<!-- region:feature:notification -->

- `NotificationCenter` 消息中心（`NotificationBell` + Popover + `NotificationPanel`，props 驱动；业务类型 / 文案高亮 / 跳转通过 `typeRegistry`、`emphasis`、`onItemClick` 注入；后端通用内核、SSE 与数据层见 README「消息通知后端」）

<!-- endregion:feature:notification -->

<!-- region:feature:audit-log -->

- `AuditDiffViewer` 审计变更三态 Diff（标量 / 标签数组 / 键值对象，自动展开 snapshot 形）

<!-- endregion:feature:audit-log -->

登录内核组件在 `@workspace/web-core/components/shared/*`：

- `PermissionGate` 声明式权限门控

## Page Transitions

Native **View Transitions API** (React Router DOM v7). All `<NavLink>` use `viewTransition` prop. New routes inherit transitions automatically.

## Code Conventions

- **页面拆分标准**：页面组件超过 400 行触发拆分（`bun run arch:check` 的 450 行是 CI 硬上限，400 行是拆分软线），拆分对象是自包含大块（弹窗/表单体/局部块 → `pages/<module>/components/`，表单/业务逻辑 → `pages/<module>/hooks/`）；不为凑行数硬拆小块（确认弹窗/列定义等可留主文件），拆后主文件以清晰编排为目标（~600 行可接受）。
- **Import order**: `eslint-plugin-simple-import-sort`, auto-fix via `bun run lint:fix`
- **Type Safety**: tsconfig enforces `noUnusedLocals` + `noUnusedParameters`
- **Toast**: Use `@workspace/web-core/lib/toast` (`showSuccess` / `showError` / `showWarning` / `showInfo`). Never import sonner directly.
- **Forms**: Use `react-hook-form` + Zod schemas from `shared` package for validation.
- **Path alias**: `@/*` maps to `./src/*` in web app.
- **Date/Time**: 展示用 `formatDate` / `formatTimestamp`（`@workspace/ui/lib/date-utils`，本地时区）；日期范围查询前端用 `getLocalDayBoundaryISO(date, "start"|"end")` 构造完整 ISO。

## Testing

- **测试文件就近放置**：`foo.ts` → 同目录 `foo.test.ts`
- **API 端用 `bun:test`**：`import { describe, it, expect } from "bun:test"`，原生支持 `bun:sqlite`
- **Web/Shared 端用 Vitest**：`import { describe, it, expect } from 'vitest'`，配合 `happy-dom`
- **前端 Service 测试**：`vi.mock('@workspace/web-core/lib/api')` mock axios 实例，验证 URL/参数/返回值
- **前端 Store 测试**：直接操作 `useXxxStore.getState()`，`beforeEach` 中 `localStorage.clear()` + `setState` 重置
- **工具脚本测试**：`scripts/*.ts` 同目录 `*.test.ts`，用 `bun:test`，运行 `bun run test:scripts`（已包含在 `bun run test`）
- **API 路由测试**：内存 SQLite（`:memory:`）+ migrate + 种子数据，`beforeEach` 重置
- **API 中间件测试**：mock `jsonwebtoken`，构造 Hono app 用 `app.request()` 模拟请求
- **ESLint 自定义规则测试**：规则同目录放置 `*.test.js`，用 `bun:test` + `RuleTester` 覆盖 valid / invalid 案例，运行 `bun run test:eslint`

### Agent 变更后验证（强制）

- **代码变更后必须立即执行对应测试并通过**：API → `bun run test:api`；端内前端 → `bun run test:web`；`packages/ui` → `bun run test:ui`；`packages/web-core` → `bun run test:web-core`；Shared → `bun run test:shared`；跨层 → `bun run test`。改 `eslint-rules/`、`eslint.config.js` 或规则实现 → `bun run test:eslint` + **`bun run lint:nocache`**（ESLint 默认 `--cache` 的 hash 只含配置、不含自定义规则实现，规则改动后带缓存可能复用旧结果；`lint:nocache` 逐包 `--no-cache` 才是可信验收）。
- 未执行 = 任务未完成；失败必须修复重跑直到通过。

## 枚举值规范

- **DB 与接口一律存英文枚举值，中文仅 UI 展示**。枚举定义在 `packages/shared/src/`（英文值常量 + `*_LABELS` 中文映射）；比较用英文字面量，赋值用常量，展示用 `*_LABELS[值]`。
- 颜色/图标等 `Record<string, …>` 映射的 key、test factory 数据同样必须用英文值。

<!-- region:cmds -->

## 🛠️ Commands

```bash
bun run dev          # 自动编译 shared 后并发启动 API (3000) + Web (5173)
bun run check        # 一键全量门禁（typecheck + lint + migrate:check + arch:check + test，对齐 CI）
bun run typecheck    # 全局类型检查
bun run lint         # ESLint（各 web 端 + api + packages/*，含后端架构约束）
bun run lint:nocache # ESLint 无缓存验收（改自定义规则/配置后用，避免旧缓存掩盖）
bun run lint:fix     # ESLint 自动修复
bun run test         # 运行全部测试（ESLint 规则 + scripts + Shared + UI + Web Core + 各 web 端 + API）
bun run test:eslint  # 自定义 ESLint 规则的 RuleTester 测试
bun run test:api     # 仅 API 测试 (bun:test)
bun run test:web     # 各端前端测试 (Vitest，遍历端注册表)
bun run test:shared  # 仅 Shared 包测试 (Vitest)
bun run test:ui      # 仅 @workspace/ui 测试 (Vitest)
bun run test:web-core # 仅 @workspace/web-core 测试 (Vitest)
bun run arch:check   # 跨文件架构约束扫描（页面必须 React.lazy 等）
bun run gen:module   # 业务模块生成器（--mode sortable 生成字典/拖拽重排模块；--app <id> 只生成该端前端切片）
bun run remove:module # 业务模块对称卸载（区块剥离 + 反向引用预检 + 规格书归档；--app <id> 只拆该端切片，--all-apps 全域，--app <id> --all-modules 清空该端）
bun run add:web      # 新增 Web 端（--id <id> --title <名称> [--blank]；克隆默认端或生成极简空壳 + 改身份 + 注册，不 install）
bun run remove:web   # Web 端对称卸载（--id <id>；删目录 + 剥 web-app:<id> 区块 + 反向引用预检）
bun run imports:prune # 删除区块剥离后残留的未使用 import（RemoveUnused，不重排）
bun run test:scripts # scripts/ 工具脚本单测（含 gen:module 生成器）
bun --filter api db:generate  # 生成项目：schema 变更后生成迁移
bun --filter api db:migrate   # 生成项目：把迁移应用到本地数据库
bun run db:reset     # 重置本地开发数据库（重建 + 种子）
```

<!-- region:template-only -->

**模板仓库专属命令**（生成项目已删除 init.sql，不适用）：

```bash
bun --filter api db:init:generate # 从 schema.ts 重新生成 init.sql
bun --filter api db:init:check    # 校验 init.sql 与 schema.ts 是否一致
```

<!-- endregion:template-only -->

<!-- endregion:cmds -->

## Git Conventions

**Commit**: `<type>(<scope>): <subject>` — subject ≤50 chars, imperative mood
**Type**: `feat` · `fix` · `refactor` · `docs` · `test` · `chore` · `perf` · `ci` · `style`
**Branch**: `feature/<module>-<desc>` · `fix/` · `hotfix/` · `release/v<ver>` · `refactor/`
**Rule**: Never push cross-branch. Always checkout target branch before push.
**PR**: Must include change description + scope + test result + linked ID (`Fixes #123`); ≤500 lines.
