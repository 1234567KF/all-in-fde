---
name: business-feature-builder
description: >-
  Use when building a new business module, CRUD page, dictionary or category management feature, or full-stack domain in this monorepo. Guides 5-element requirement alignment, scaffolds full-stack files via gen:module, implements shared Zod contracts, Drizzle SQLite schema, ServiceError invariants, declarative audit logs, and Liquid Glass UI components, and verifies all architecture gates.
metadata:
  pattern: inversion + pipeline
  domain: fullstack-business-module
---

# Overview

Execute this workflow to build or evolve a production-ready full-stack business module across `packages/shared`, `apps/api`, and `apps/<appId>` (default `web`; inspect `web-apps.json` when present for multi-app workspaces). Follow all phases in strict sequential order. Do NOT skip phases or write application code before the requirement and 5-element specification are aligned.

## Human vs. AI Responsibility Boundary

- **Human provides**: Raw business intent in natural language (a few sentences, raw PRD files, prototype HTML files, screenshots, task cards, or change requests) and confirms ambiguous business decisions (fields, invariants, permissions). The human NEVER manually creates folders in `docs/requirements/` or manually copies/fills out `docs/specs/<name>.md`.
- **AI owns**:
  1. **Auto-archiving raw inputs (when provided)**: Filing new raw PRD/HTML/asset files provided outside `docs/requirements/` into `docs/requirements/v<X.Y>/`, and linking them in `docs/specs/<name>.md` under `0.2 版本演进记录`. If files are already under `docs/requirements/v<X.Y>/`, reference them in place without duplicating. Ad-hoc conversational tweaks without raw files do NOT create directories in `docs/requirements/`.
  2. **Translating intent & HTML prototypes into the 5-element specification**: Extracting information architecture (fields, filter controls, columns, dialog inputs, state tabs/steps) from raw PRDs and prototype HTML while redesigning cramped layouts and hardcoded HTML colors/styles into Liquid Glass components (`DESIGN.md`) and `--lg-*` tokens.
  3. **Interviewing the user ONLY on ambiguous business rules** (Phase 1), then generating or updating `docs/specs/<name>.md` (including Section 0 Business Context & Version History + Elements 1–5) as the persistent domain record.
  4. **Running `bun run gen:module`** (Phase 2), implementing full-stack code and tests (Phases 3–5), and passing all verification gates (Phase 6).

---

# Workflow

## Phase 1 — Requirement Alignment & Spec Generation (Inversion Gate)

1. **Raw Material Intake & Auto-Archiving (`docs/requirements/v<X.Y>/`)**:
   - Check whether the user supplied raw product artifacts (PRD `.md`/`.pdf`, prototype `.html`, or screenshots/assets) via workspace paths, external file paths (e.g., `~/Downloads/...`), or pasted content:
     - **Already under `docs/requirements/v<X.Y>/`**: Do NOT copy, move, or duplicate them; simply reference their relative path in `0.2 版本演进记录`.
     - **New raw artifacts elsewhere**: Automatically archive them under `docs/requirements/v<X.Y>/` (e.g., `docs/requirements/v1.0/prd.md`, `docs/requirements/v1.0/<name>.html`, `docs/requirements/v1.0/assets/`). Move temporary files dropped in the workspace root or copy files from external paths so `docs/requirements/v<X.Y>/` preserves a clean, read-only snapshot of that release's product inputs.
     - **Prototype HTML consumption rule ("keep semantics, redesign UI & skin")**: Parse `.html` prototypes to extract fields, table columns, filter controls, status semantics, and modal inputs automatically (do NOT re-ask the user for fields already visible in the HTML), but **NEVER** copy hardcoded hex/RGB/Tailwind raw color classes, `<table>`/`<dialog>` markup, or cramped/over-flattened prototype layouts into `apps/<appId>` — redesign flows with `DataTable`, `FilterBar`, `ResponsiveDialog`, `MobileCard`, wizards/tabs, and `--lg-*` tokens.
     - **Conversational tweaks without raw files**: Do NOT create an empty folder under `docs/requirements/`; record `对话直接指令（无外部附件）` in the `原始资料归档 (PRD / 原型)` column of `0.2 版本演进记录`.
2. **Check whether `docs/specs/<name>.md` already exists (Read Always, Write Only on 5-Element Change)**:
   - **Existing module iteration (`v1.x` minor/patch update)**: Always read `docs/specs/<name>.md` first to restore full business context and prior invariants.
     - **When to update the Spec**: Update `docs/specs/<name>.md` (bump `version` in frontmatter, append a row to `0.2 版本演进记录`, and update Sections 1–5 in place) **ONLY when the 5 elements themselves change** (fields/enums, API contracts, business invariants/error rules, UI functional blocks, or permissions/audit) or when a bugfix reveals a missing domain rule in Element 2/3.
     - **When NOT to update the Spec**: Pure implementation bugfixes (fixing code to match existing Spec rules), UI styling tweaks, SQL/performance optimizations, or file-splitting refactors do **NOT** modify `docs/specs/<name>.md` or bump its version.
   - **Major breaking redesign (`v1.x` → `v2.0`)**: Archive the previous living spec to `docs/specs/archive/v1/<name>.md` before rewriting `docs/specs/<name>.md` as `v2.0`.
   - **New module (`v1.0`)**: Read [docs/specs/_template.md](../../../docs/specs/_template.md) to load the target structure (`Frontmatter` + `Section 0: Business Context & Version History` + `Generator Metadata` + `Elements 1–5`).
3. **Derive the specification from the user's prompt & raw artifacts**:
   - **Section 0 — Business Context & Requirements**: Business goal, target roles, user stories, and out-of-scope boundaries.
   - **Generator Metadata**: `--name` (kebab-case), `--label` (Chinese title ≤ 30 chars), `--icon` (Lucide icon name, default `FileText`), `--mode` (`crud` for server-paged CRUD, `sortable` for full-list dictionary with `sortOrder` drag-and-drop).
   - **Element 1 — Entity & Shared Contract**: Fields, types, required/optional rules, uniqueness constraints, and English enum values + Chinese `*_LABELS`.
   - **Element 2 — Domain Invariants & `ServiceError`**: Conflict checks (409), not-found checks (404), reference protection before deletion (400), or state transition guards (400).
   - **Element 3 — Permissions (Opt-in)**: Permission codes (`<name>:view`, `<name>:edit` or custom actions) with 3-level tree metadata (`group`, `groupLabel`, `kind: "menu" | "action"`), target app(s), and role strategy (`admin` vs. `user` static defaults in Starter mode, or runtime assignment via Role UI if the project uses dynamic DB `roles` tables).
   - **Element 4 — Audit & Optional Side Effects**: `TableAuditConfig.fieldLabels` (column → Chinese label shown by the audit diff viewer), custom non-CRUD audit events via `createAuditor` (`{ before, after }` diffs).

<!-- region:feature:notification -->

- **Element 4 — Notification side effects (optional)**: `notify` / `notifyMany` / `notifySafe` from `apps/api/src/shared/notification.ts` when the business flow requires in-app messages (triggered after DB writes commit).

<!-- endregion:feature:notification -->

- **Element 5 — UI Layout & Components**: Target app(s) (`web`, `portal`, etc.), `FilterBar` search/filter controls, `DataTable` desktop columns, `MobileCard` three-part slots, and `ResponsiveDialog` / wizard steps (`steps/*`) / tabbed views redesigned per `DESIGN.md`.

4. **If any core business rules (Elements 1, 2, target app, or `--mode` `crud` vs. `sortable`) are missing or ambiguous**, present a concise Chinese proposal with recommended defaults and ask the user to confirm:

```markdown
收到需求。我整理了「<模块中文名>」的核心规格草案（技术细节已按项目规范填好默认值），请确认以下业务点：

- **业务场景**：<一句话概括目标与核心操作>
- **1. 生成模式与参数**：`--name <name>` · `--label "<中文名>"` · `--icon <Icon>` · `--mode <crud|sortable>` · 目标端 `apps/<appId>`
- **2. 核心字段与枚举**：<列出业务字段、必填项、唯一键及状态枚举>
- **3. 业务拦截规则**：<如编码/名称唯一性 409、删除引用保护 400、状态流转前置校验>
- **4. 权限与角色（默认推荐）**：`<name>:view` / `<name>:edit` 默认仅 `admin` 持有（是否需要默认开放给普通 `user` 角色或配置到动态角色？）
- **5. 审计与界面（默认推荐）**：全字段中文 Diff 审计（通知副作用按需接入）；按 `DESIGN.md` 重构桌面端 `DataTable` + 移动端 `MobileCard` + `ResponsiveDialog`。
```

**PHASE GATE**: Do NOT proceed to Phase 2 until the user confirms the specification, **or** enter **Fast-Track mode** immediately when the user explicitly requests direct execution (e.g., "直出") or provides an unambiguous task card/PRD + terminology spec covering all 5 elements. Once aligned, **AI writes or updates `docs/specs/<name>.md`** following `docs/specs/_template.md` before Phase 2.

---

## Phase 2 — Scaffold Baseline via `gen:module`

Run the module generator from the repository root to create the 9 baseline files and wire all registration points — **backend/shared 5** (`permissions.ts`, `audit.ts`, `shared/index.ts`, `db/schema.ts`, `api/src/index.ts`) plus **3 per app** (`query-keys.ts`, `App.tsx`, `menu-config.ts`):

```bash
# Mode A (default): Server-side paginated CRUD module
bun run gen:module --name <name> --label "<中文名>" --icon <Icon>

# Mode B: Dictionary / category module with full-list drag-and-drop sortOrder
bun run gen:module --name <name> --label "<中文名>" --icon <Icon> --mode sortable
```

- Do NOT manually create the 9 module files or hand-edit the registration files before running `gen:module`.
- Use `--dry-run` first if you only want to preview the planned file paths.

**Multi-app repos** (`web-apps.json` has more than one entry): the backend domain is registered **once**, frontend slices are per app. Run the bare command first to create the domain + default `web` slice, then `--app <id>` for each additional target app; if the module does **not** belong in `web` at all (e.g., `portal`-only feature), remove only the `web` slice right after generation:

```bash
bun run gen:module --name <name> --label "<中文名>" --icon <Icon>   # domain + web slice
bun run gen:module --name <name> --app <appId>                    # target app slice
bun run remove:module --name <name> --app web                     # optional: if not exposed in web
```

- `--app` **requires the backend domain to already exist** — it never creates it.
- `label` / `icon` default to the domain's values and may be overridden per app (affects only that app's copy and menu). A conflicting `--mode` is rejected: the frontend shape is determined by the domain.
- Removing a single slice later: `bun run remove:module --name <name> --app <id>`; removing the whole domain across multiple apps requires `--all-apps`.
- Do not hand-copy slice files between apps — copies drift and `remove:module` could no longer strip them by region.
- **Customizing `menu-config.ts`**: If you combine submodules into one tabbed workspace or split menu items manually, **always preserve the generated `// #region module:<name>` … `// #endregion module:<name>` marker lines** (even if empty) so `code-regions.ts`, `test:scripts`, and `remove:module` remain valid.

---

## Phase 3 — Customize Shared Contracts & Database Schema

1. **Update `packages/shared/src/<name>.ts` and `packages/shared/src/index.ts`**:
   - Replace placeholder fields (`code`, `name`, `status`, `description`) with the actual domain fields from Element 1.
   - Define all enums with English literal values in DB/Wire (`export const <UPPER>_STATUS = { ... } as const`) and a corresponding Chinese label record (`export const <UPPER>_STATUS_LABELS: Record<..., string> = { ... }`).
   - Keep `<Pascal>Schema` (wire output), `<Pascal>FormSchema` (create/update input), and `<Pascal>ListQueryBaseSchema` / `<Pascal>ListQuerySchema` (using `z.preprocess(stripBlankQueryValues, ...)`) in sync.
   - Export any newly added schemas, constants, or types from `packages/shared/src/index.ts`.
2. **Update `apps/api/src/db/schema.ts`**:
   - Align the Drizzle `sqliteTable` columns, `.notNull()`, `.default()`, `uniqueIndex(...)`, and `index(...)` with `packages/shared/src/<name>.ts`.
3. **Update Role Permissions (Static vs. Dynamic DB RBAC)**:
   - By default, `gen:module` registers `PERMISSIONS.<UPPER>_VIEW` and `PERMISSIONS.<UPPER>_EDIT` in `PERMISSION_REGISTRY` (check whether the repo's `PERMISSION_META` uses `group`, `groupLabel`, `kind: "menu" | "action"`).
   - **Starter static mode**: Add permissions for `user` or other static roles in `ROLE_PERMISSIONS` inside `packages/shared/src/permissions.ts`.
   - **Dynamic DB-role project** (when `roles` / `role_permissions` tables exist in DB): Seed/sync permissions in the DB role service & seed script as well, keeping `PERMISSION_REGISTRY` in `packages/shared/src/permissions.ts` as the single permission-code registry.
4. **Synchronize Database Artifacts & Shared Build**:
   - Check which database mode the workspace uses:
     - **Template repository** (`apps/api/init.sql` exists): run `bun --filter api db:init:generate`.
     - **Scaffolded project** (`apps/api/init.sql` does not exist, `apps/api/drizzle/meta/_journal.json` exists): run `bun --filter api db:generate`.
   - Rebuild the shared package so `apps/api` and `apps/*` see the updated types and runtime schemas:
     ```bash
     bun run build:shared
     ```

---

## Phase 4 — Implement Backend Service, Audit & Route Tests

> **Complex Business Recipes**: Whenever the module involves **non-CRUD state-machine actions** (e.g., approve/reject + `createAuditor`), **cross-module dictionary/FK selects** (avoiding N+1 + delete reference protection), **file attachment uploads** (`shared/oss.ts` + `FileUpload`), or **pages exceeding 400 lines**, read and follow [references/advanced-patterns.md](references/advanced-patterns.md).

<!-- region:feature:notification -->

> **Notification recipe**: 若业务流需要站内通知副作用（`notifySafe`），同一份 [advanced-patterns.md](references/advanced-patterns.md) 的范式一给出了完整示例（含 ④ 异步通知）。

<!-- endregion:feature:notification -->

1. **Update `apps/api/src/modules/<name>/<name>.service.ts`**:
   - Update `<UPPER>_AUDIT_CONFIG: TableAuditConfig` (`fieldLabels`, `snapshotColumns`, `excludeColumns`).
   - Implement Element 2 domain invariants via `ServiceError` subclasses (`new ServiceError(message, status, code)` — note parameter order!).
   - For dictionary/category modules (`sortable`) or master data referenced by other tables, implement delete reference protection before deleting the row (status `400`).
   - Ensure every exported function calling `auditedInsert`, `auditedUpdate`, `auditedDelete`, or `audit` accepts `ctx: OpCtx` as its first parameter; non-CRUD `createAuditor(...)` entries use `changes: { 字段名: { before, after } }`.

<!-- region:feature:notification -->

- Trigger optional notifications via `notify()` / `notifyMany()` / `notifySafe({ recipientId, ... })` **outside and after** database write transactions commit (`apps/api/src/shared/notification.ts`).

<!-- endregion:feature:notification -->

2. **Update `apps/api/src/modules/<name>/<name>.route.ts`**:
   - Keep route handlers thin: `authMiddleware` / `opCtxMiddleware` → `requirePermission(...)` → `parseId` / `safeJson` / Zod `safeParse` (`fail(..., formatZodErrors(parsed))`) → service call → `mapServiceError(c, err)`.
   - Never import database modules or `ali-oss` in `.route.ts`; never double-prefix routes with `/api` inside `createApp()` mounts.
3. **Update `apps/api/src/modules/<name>/<name>.route.test.ts`**:
   - Update `validForm` fixtures and test cases to match the customized fields and domain invariants (401, 403, 201 + create audit snapshot, 400 validation, 409 conflict, 400 reference protection if applicable, 200 update + `{ before, after }` diff audit, 200 delete + audit, 404 not found).
   - Keep `setupTestDb()` in `beforeEach` for isolated in-memory SQLite runs.

---

## Phase 5 — Implement Frontend Hooks, Page & Form Dialog

Implement the UI inside the target app slice(s) `apps/<appId>/src/pages/<name>/` (e.g., `apps/web/src/pages/<name>/`):

1. **Update `apps/<appId>/src/pages/<name>/hooks/use<Pascal>Form.ts`**:
   - Update `makeEmptyValues()` and `toFormValues(record)` to match `<Pascal>Form` (convert nullable wire fields to `""` for controlled inputs).
2. **Update `apps/<appId>/src/pages/<name>/components/<Pascal>FormDialog.tsx`**:
   - Render form fields inside `ResponsiveDialog` using `Field`, `FieldLabel`, `FieldError`, `Input`, `Select`, `Textarea`.
   - For file uploads, keep `packages/ui/src/components/shared/FileUpload.tsx` strictly prop-driven (zero `@workspace/web-core` or network imports in `packages/ui`); wire OSS/API upload hooks inside app `services/` or `@workspace/web-core/services/`.
   - Keep the error round-trip in `handleSubmit`:
     ```ts
     if (!applyServerFieldErrors(err, form.setError)) {
       showError(extractErrorMessage(err))
     }
     ```
3. **Update `apps/<appId>/src/pages/<name>/<Pascal>Page.tsx`**:
   - Configure `FilterBar` (`search` + filter selects + accurate `activeFilterCount`), `DataTable` (`StatusBadge`, `DateCell`, `NullableText`, `Badge`), and `mobileCard` (`MobileCard`, `MobileCardTitle`, `MobileCardTags`, `MobileCardMeta`).
   - Gate write actions (`新增`, `编辑`, `删除`, and `draggable` / `onReorder`) with `usePermission().can(PERMISSIONS.<UPPER>_EDIT)` or `<PermissionGate perm={PERMISSIONS.<UPPER>_EDIT}>`.
   - Redesign complex workflows for real usability per `DESIGN.md` rather than mirroring flat prototype HTML tables/walls; if the page approaches 400 lines (hard CI limit is 450 lines), extract dialogs/drawers/steps/columns into `apps/<appId>/src/pages/<name>/{components,steps,hooks}/`.

---

## Phase 6 — Mandatory Quality Gates & Self-Check

Run the unified verification command from the repository root (which chains `typecheck`, `lint`, `migrate:check`, `arch:check`, and `test`) and fix any failures before reporting completion:

```bash
bun run check
```

If you modified custom ESLint rules or want to bypass the ESLint cache explicitly, also run `bun run lint:nocache`. If invoked from a project task breakdown / checklist card, tick **only** the AI-implementation / self-check boxes and fill the handoff receipt after `bun run check` passes (never auto-check human review or QA sign-off boxes).

**Self-Check Checklist before finishing**:

- [ ] All enum values stored in DB and sent over the wire are English literals; Chinese labels are used only in UI (`*_LABELS`) and `TableAuditConfig.fieldLabels`.
- [ ] No raw Tailwind colors (`text-red-500`, `bg-emerald-500`) or inline style hex/rgb/hsl literals exist in `.tsx` files; semantic tokens (`var(--lg-danger)`, `StatusBadge`, `variant="destructive"`) are used instead.
- [ ] No value imports of `@/services/*` or `@workspace/web-core/services/*` exist in `apps/*/src/pages/**`, `apps/*/src/components/**`, or `packages/{ui,web-core}/src/components/**` (only `import type` is allowed; runtime calls go through `hooks/queries/`).
- [ ] Every file under `apps/*/src/pages/**/*.tsx` and `apps/api/src/modules/**/*.ts` is strictly under 450 lines (`wc -l`).
- [ ] All `[gen:module:*]` anchor comments and paired `// #region module:<name>` markers (including inside customized `menu-config.ts`) remain intact.
- [ ] Routes registered inside `createApp()` omit the `/api` prefix.
- [ ] In multi-app repos, the backend domain registration exists **exactly once** (one permission code set, one audit module, one table, one route mount); only per-app frontend registrations repeat, and each app's slice was produced by `gen:module --app <id>` rather than hand-copied.

---

# Gotchas

- **Template Repo vs. Scaffolded Project DB Sync**: Never run `bun --filter api db:generate` in the template repository (where `apps/api/init.sql` exists); the pre-commit hook and `migrate:check` reject `apps/api/drizzle/` files in template mode. Conversely, in a scaffolded project (`apps/api/init.sql` removed), always use `bun --filter api db:generate`.
- **Shared Package `dist/` Resolution**: Both `apps/api` and `apps/*` resolve `"shared"` to `packages/shared/dist/`. Whenever you edit `packages/shared/src/*.ts`, run `bun run build:shared` (included in `bun run typecheck`) before running single-package tests like `cd apps/api && bun test`.
- **No `/api` Prefix Inside `createApp()`**: Never write `app.route("/api/foo", ...)` inside `apps/api/src/index.ts`; `rootApp.route("/api", app)` and Vite `/api` rewrites automatically prepend/strip `/api`, so double-prefixing produces `/api/api/...`.
- **Preserve `#region module:<name>` When Merging/Splitting Menus**: When merging submodules into tabs or splitting one domain into multiple menu items in `menu-config.ts`, keep every `// #region module:<name>` … `// #endregion module:<name>` pair intact (even if empty) so `remove:module` and `test:scripts` pass.
- **ESLint Custom Rules & Cache**: `bun run lint` uses `--cache`. When verifying across architecture rules, run `bun run lint:nocache` so ESLint evaluates all files without stale cache hits.
- **Route Layer Import Ban**: `*.route.ts` files are strictly forbidden from importing `**/db*`, `drizzle-orm`, `bun:sqlite`, or `ali-oss` (both static `import` and dynamic `import()`). Keep all SQL queries and OSS calls inside `*.service.ts`.
- **Frontend Permission Source of Truth**: Never import `ROLE_PERMISSIONS`, `ALL_PERMISSIONS`, or `permissionsForRole` in `apps/*/src/**` or `packages/{ui,web-core}/src/**` (blocked by ESLint `no-restricted-imports`). Always consume `user.permissions` via `usePermission()` or `<PermissionGate>`.
- **LIKE Wildcard Escaping**: When adding custom `LIKE` filters in `*.service.ts`, escape `%`, `_`, and `\` via `escapeLike(keyword)` and append `ESCAPE '\\'` in the SQL template so user input containing `%` or `_` cannot match unintended rows.
