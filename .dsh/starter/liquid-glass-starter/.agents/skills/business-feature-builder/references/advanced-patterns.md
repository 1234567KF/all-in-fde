# 复杂业务进阶范式速查（Advanced Business Patterns）

> **设计依据说明**：本文档中的 4 套范式**并非外部通用教条**，而是 100% 提炼自本仓库已落地的共享内核（`apps/api/src/shared/*`）、共享 UI 原语（`packages/ui/src/components/shared/*`）、标杆模块（`modules/user` · `modules/auth`）以及 AST 架构门禁（`eslint-rules/*` + `scripts/arch-check.ts`）。
> 当业务需求超出 `bun run gen:module` 生成的基础单表 CRUD / Sortable 骨架时，严格按以下标准配方组装，避免自由发挥触发门禁或破坏架构一致性。

---

## 范式一：非 CRUD 状态机动作（如审批通过 / 驳回 / 作废 / 上下架）

**依据来源**：

- 审计门禁：`eslint-rules/no-audit-fn-without-opctx.js`（写审计的导出函数首参必须为 `OpCtx`）与 `apps/api/src/shared/audit-log.ts`（`createAuditor`）
- 领域异常：`apps/api/src/shared/service-error.ts`（`ServiceError(message, status, code)` + `mapServiceError`）

<!-- region:feature:notification -->

- 消息通知：`apps/api/src/shared/notification.ts`（`notifySafe` 异步不阻塞主业务，需在 DB 写事务提交后调用）

<!-- endregion:feature:notification -->

- 标杆参考：`apps/api/src/modules/user/user.service.ts` · `apps/api/src/modules/user/user.route.ts`

### 1. Shared 契约层（`packages/shared/src/<name>.ts`）

状态流转动作单独定义入参 Schema（如驳回必填原因）：

```ts
export const RejectContractSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "请填写驳回原因")
    .max(200, "驳回原因最多 200 字"),
})
export type RejectContractInput = z.infer<typeof RejectContractSchema>
```

同时在 `packages/shared/src/audit.ts` 的 `MODULE_EVENT_TYPES[<name>]` 中登记动作事件名（如 `"approve"` / `"reject"`）。

### 2. Service 领域层（`apps/api/src/modules/<name>/<name>.service.ts`）

必须包含 **① 存在性校验（404）→ ② 前置状态机守卫（409）→ ③ 状态更新与审计（`createAuditor` 或 `auditedUpdate`）**：
<!-- region:feature:notification -->

若需求包含通知副作用，再于**事务提交后**执行 **④ 异步通知（`notifySafe`，见下方示例；禁止包在数据库外层事务内）**。
<!-- endregion:feature:notification -->

```ts
import { eq } from "drizzle-orm"
import { AUDIT_MODULES } from "shared"
import { getDrizzle } from "../../db"
import { contracts } from "../../db/schema"
import { createAuditor } from "../../shared/audit-log"
// #region feature:notification
import { notifySafe } from "../../shared/notification"
// #endregion feature:notification
import type { OpCtx } from "../../shared/op-context"
import { ServiceError } from "../../shared/service-error"

const audit = createAuditor(AUDIT_MODULES.CONTRACT)

export async function rejectContract(
  ctx: OpCtx,
  id: number,
  input: RejectContractInput
): Promise<Contract> {
  const db = getDrizzle()
  const existing = db.select().from(contracts).where(eq(contracts.id, id)).get()
  if (!existing) {
    throw new ServiceError("合同不存在", 404, "NOT_FOUND")
  }
  // 前置状态机守卫：仅允许从 pending 流转到 rejected
  if (existing.status !== "pending") {
    throw new ServiceError("仅待审批状态的合同可执行驳回操作", 409, "CONFLICT")
  }

  const now = new Date().toISOString()
  db.update(contracts)
    .set({ status: "rejected", rejectReason: input.reason, updatedAt: now })
    .where(eq(contracts.id, id))
    .run()

  const updated = db.select().from(contracts).where(eq(contracts.id, id)).get()!

  // 非标准 CRUD 动作使用 createAuditor(module) 双参调用，changes 字段结构固定为 { before, after }
  audit(ctx, {
    eventType: "reject",
    target: existing.name,
    targetId: String(id),
    changes: {
      状态: { before: existing.status, after: "rejected" },
      驳回原因: { before: existing.rejectReason ?? null, after: input.reason },
    },
    metadata: { reason: input.reason },
  })

  // #region feature:notification
  // 事务提交后再触发站内实时通知（notifySafe 内部捕获异常，绝不阻断主流程返回）
  if (existing.creatorId) {
    await notifySafe({
      recipientId: existing.creatorId,
      type: "contract.rejected",
      title: `合同「${existing.name}」已被驳回`,
      body: `驳回原因：${input.reason}`,
      payload: { targetId: id, code: existing.code, routePath: "/contracts" },
    })
  }
  // #endregion feature:notification

  return toContractDto(updated)
}
```

### 3. Route 层（`apps/api/src/modules/<name>/<name>.route.ts`）

静态子路径或动作路由挂载在 `POST /:id/<action>`，复用 `parseId`、`safeJson`、`fail(..., formatZodErrors(parsed))` 与 `mapServiceError(c, err)`（注意 `createApp()` 内 `app.route("/<plural>", ...)` 不要手写 `/api` 前缀）：

```ts
route.post(
  "/:id/reject",
  requirePermission(PERMISSIONS.CONTRACT_EDIT),
  async (c) => {
    const id = parseId(c.req.param("id"))
    if (id === null) {
      return fail(c, 400, "VALIDATION_ERROR", "ID 必须为正整数")
    }
    const body = await safeJson(c)
    if (!body) {
      return fail(c, 400, "VALIDATION_ERROR", "请求体必须为有效 JSON")
    }
    const parsed = RejectContractSchema.safeParse(body)
    if (!parsed.success) {
      return fail(
        c,
        400,
        "VALIDATION_ERROR",
        "请求参数校验失败",
        formatZodErrors(parsed)
      )
    }
    try {
      const data = await rejectContract(c.get("opCtx")!, id, parsed.data)
      return ok(c, { contract: data }, "已驳回")
    } catch (err) {
      return mapServiceError(c, err)
    }
  }
)
```

---

## 范式二：跨模块字典 / 外键关联（避免 N+1 与违反 Route 禁连 DB 门禁）

**依据来源**：

- 后端门禁：`eslint.config.js` 禁止 `*.route.ts` import `db` / `drizzle-orm`
- 前端门禁：`eslint-rules/no-service-import-in-ui.js`（UI 层只能调 `hooks/queries/*`）

### 1. 后端批量组装关联名称（在 `*.service.ts` 内完成，严禁 N+1）

当「合同（`contracts`）」包含 `categoryId` 关联「分类字典（`categories`）」时：

- **单表 `inArray` 批量回填（推荐，类型最清晰）**：
  ```ts
  const db = getDrizzle()
  const categoryIds = [
    ...new Set(
      rows.map((r) => r.categoryId).filter((id): id is number => id != null)
    ),
  ]
  const categoryMap = new Map<number, string>()
  if (categoryIds.length > 0) {
    const cats = db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.id, categoryIds))
      .all()
    for (const c of cats) categoryMap.set(c.id, c.name)
  }
  ```
- **被引用方的删除保护（填充 `sortable` 模块预留的 `TODO(引用保护)`）**：
  在 `category.service.ts` 的 `removeCategory` 中补齐引用计数拦截：
  ```ts
  const refRow = db
    .select({ total: count() })
    .from(contracts)
    .where(eq(contracts.categoryId, id))
    .get()
  if ((refRow?.total ?? 0) > 0) {
    throw new ServiceError(
      `该分类已被 ${refRow!.total} 份合同引用，无法删除`,
      400,
      "CATEGORY_IN_USE"
    )
  }
  ```

### 2. 前端表单下拉复用关联模块 Query Hook

在 `ContractFormDialog.tsx` 中，直接调用关联模块的 `useCategoriesList()`（来自 `@/hooks/queries/useCategory`），无需新建重复接口：

```tsx
const { data: categories = [] } = useCategoriesList()
// 仅展示启用状态的字典项（编辑态若原值已停用仍保留回显）
const availableCategories = useMemo(
  () =>
    categories.filter(
      (c) => c.status === "enabled" || c.id === currentCategoryId
    ),
  [categories, currentCategoryId]
)
```

---

## 范式三：业务单据接入文件 / 附件上传

**依据来源**：

- 后端双模存储：`apps/api/src/shared/oss.ts`（`uploadObject` / `getObjectUrl`）与 ESLint `api-oss-import-guard`（业务模块禁直连 `ali-oss`）
- 前端上传原语：`packages/ui/src/components/shared/FileUpload.tsx`

### 1. 后端模块上传处理（在 `*.service.ts` 调用 `shared/oss.ts`）

- 业务模块严禁 `import OSS from "ali-oss"`，统一走 `apps/api/src/shared/oss.ts`。
- 环境变量未配齐 OSS 密钥时自动降级本地 Mock 存储，业务代码零分支感知。

### 2. 前端表单接入 `<FileUpload>`（严守 `@workspace/ui` 零网络边界）

- `packages/ui/src/components/shared/FileUpload.tsx` 默认只管理本地 `File[]` 选择（`onChange`）。若需直传 OSS 并展示已上传元信息，**只可在 `packages/ui` 中扩展纯 prop 回调（如 `onUpload` / 受控附件数组）**，**严禁在 `packages/ui` 内 import `@workspace/web-core` 或直接发起网络请求**。
- 将签发直传与元信息接口封装在 `@workspace/web-core/services/`（跨端复用）或 `apps/<appId>/src/services/` + `hooks/queries/`，再由 `*FormDialog.tsx` 通过 Hook 调上传并调用 `react-hook-form` 的 `setValue("attachmentUrl", url, { shouldDirty: true, shouldValidate: true })`。

---

## 范式四：页面超过 400 行时的标准拆解结构

**依据来源**：

- 架构门禁：`scripts/arch-check.ts` Rule 5（单文件硬上限 **450 行**，触发 `file-too-long` 阻断 CI）
- 代码规范：`AGENTS.md`「页面拆分标准」（**400 行软线触发拆分**）
- 多端边界：`AGENTS.md`「前端分包与依赖方向」（被第二个 `apps/<id>` 复用时才提升到 `@workspace/ui` / `@workspace/web-core`）

<!-- region:feature:audit-log -->

- 标杆参考：`apps/web/src/pages/audit-log/AuditLogPage.tsx` + `AuditLogDetailDialog.tsx`

<!-- endregion:feature:audit-log -->

当某个端（`apps/<appId>`，默认 `web`）的业务页面包含「复杂筛选 + 多列表格 + 新建/编辑弹窗 + 详情抽屉 + 审批/分步向导」时，单文件必然突破 400 行。必须按以下目录就近拆分（**子组件文件名不以 `Page.tsx` 结尾**，避免触发 `arch:check` Rule 4 的 `page-must-lazy` 路由检查）：

```text
apps/<appId>/src/pages/<name>/
├── <Pascal>Page.tsx                  # 主编排页（仅保留状态编排 + FilterBar + DataTable + 弹窗挂载，控制在 250 行内）
├── components/
│   ├── <Pascal>FormDialog.tsx        # 新建/编辑弹窗（gen:module 已默认拆出）
│   ├── <Pascal>DetailDialog.tsx      # 详情查看弹窗/抽屉（使用 ResponsiveDialog + SectionCard + DetailRow）
│   └── <Pascal>RejectDialog.tsx      # 专项业务动作弹窗（如驳回原因输入）
├── steps/                            # 多步向导/长表单场景按步骤拆入（避免单页堆砌）
└── hooks/
    ├── use<Pascal>Form.ts            # 表单状态与提交编排（gen:module 已默认拆出）
    └── use<Pascal>Columns.tsx        # 当表格列超过 6 列或含复杂操作按钮组时，将 columns 定义拆入此 Hook
```
