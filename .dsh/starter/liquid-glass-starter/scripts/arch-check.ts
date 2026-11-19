#!/usr/bin/env bun
/**
 * 架构约束检查（AGENTS.md 规范守护）
 *
 * 用法：bun run scripts/arch-check.ts
 * 退出码：0=通过 1=失败
 *
 * 检查项：
 *   1. UI 层（components/pages）禁止直接 import api 实例（应走 services/）
 *   2. UI 层禁止直接使用 axios / fetch 调后端
 *   3. 除 web-core/lib/toast.ts 与各端 App.tsx（Toaster）外，禁止直接 import "sonner"
 *   4. 页面文件（除 LoginPage）必须在 App.tsx 中通过 React.lazy 引入
 *   5. 单文件行数棘轮：pages 下 .tsx 与 api modules 下 .ts 超过 450 行即失败；
 *      存量超长文件列入 LONG_FILE_RATCHET，行数必须等于基线——只许下调、不许回涨
 *      （行数口径同 `wc -l`；web 对应 AGENTS.md「页面拆分标准」）
 *   6. 业务模块规格书守护：apps/api/src/modules/<name>（排除内置底座 auth/user/log/notification）
 *      必须存在对应的 docs/specs/<name>.md（仅校验存在性，不拦截日常修 Bug 与重构）
 *   7. 依赖方向：各端之间禁止互相 import，共享包不得 import 某个端的源码
 *   8. 端身份不变量：各端 package.json name / vite APP_ID / vitest readWebApp id /
 *      tsconfig tsBuildInfoFile 文件名都必须等于注册表 id（漏改会静默串端）
 *
 * 扫描范围：各端 apps/<id>/src + packages/ui/src + packages/web-core/src
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

// Windows 上 URL.pathname 形如 /C:/repo/，join 后会得到 \C:\repo；fileURLToPath 才是跨平台取真实路径的方式。
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const API_MODULES = join(ROOT, "apps/api/src/modules")

// 端注册表：逐端扫描，新增端不需要改本脚本。
// 刻意内联读取而不 import scripts/lib/web-apps.ts——`--mode add-ci` 会把本文件
// 单独 stamp 进目标项目，不能给它引入新的 import 依赖。
const WEB_APP_IDS: string[] = (
  JSON.parse(readFileSync(join(ROOT, "web-apps.json"), "utf-8")) as {
    apps: { id: string }[]
  }
).apps.map((a) => a.id)
const WEB_SRC_ROOTS = WEB_APP_IDS.map((id) => join(ROOT, "apps", id, "src"))
// 共享包与各端受同一套 UI 层约束：抽包只是换了目录，不是豁免。
const SHARED_SRC_ROOTS = [
  join(ROOT, "packages/ui/src"),
  join(ROOT, "packages/web-core/src"),
]

interface Violation {
  rule: string
  file: string
  line: number
  code: string
}

const violations: Violation[] = []

/** 规则匹配与输出统一用 posix 路径，兼容 Windows 下 relative() 返回的反斜杠。 */
function toPosix(p: string): string {
  return p.replaceAll("\\", "/")
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (
      [".ts", ".tsx"].includes(extname(name)) &&
      !name.endsWith(".d.ts") &&
      !name.includes(".test.")
    ) {
      out.push(p)
    }
  }
  return out
}

// sonner 直连白名单：内核 wrapper 本身与各端 App.tsx 顶层 Toaster
const SONNER_ALLOWLIST = new Set([
  join(ROOT, "packages/web-core/src/lib/toast.ts"),
  ...WEB_SRC_ROOTS.map((src) => join(src, "App.tsx")),
])

const files = [...WEB_SRC_ROOTS, ...SHARED_SRC_ROOTS].flatMap((src) =>
  walk(src)
)

for (const file of files) {
  const rel = toPosix(relative(ROOT, file))
  const lines = readFileSync(file, "utf-8").split("\n")
  const isUiLayer =
    /^(?:apps\/[^/]+|packages\/(?:ui|web-core))\/src\/(?:components|pages)\//.test(
      rel
    )

  lines.forEach((line, i) => {
    const lineNo = i + 1
    const trimmed = line.trim()

    // Rule 1: UI 层禁直连 api 实例（宿主别名与内核包两种说明符）
    if (
      isUiLayer &&
      /from\s+["'](?:@\/lib\/api|@workspace\/web-core\/lib\/api)["']/.test(
        trimmed
      )
    ) {
      violations.push({
        rule: "ui-no-direct-api",
        file: rel,
        line: lineNo,
        code: trimmed,
      })
    }

    // Rule 2: UI 层禁 axios / fetch 直连
    if (isUiLayer && /from\s+["']axios["']/.test(trimmed)) {
      violations.push({
        rule: "ui-no-axios",
        file: rel,
        line: lineNo,
        code: trimmed,
      })
    }

    // Rule 3: 除白名单外禁 import "sonner"
    if (/from\s+["']sonner["']/.test(trimmed) && !SONNER_ALLOWLIST.has(file)) {
      violations.push({
        rule: "no-direct-sonner",
        file: rel,
        line: lineNo,
        code: trimmed,
      })
    }
  })
}

// Rule 7: 依赖方向——各端之间禁止互相 import，共享包也不得 import 某个端的源码。
// 说明符可能是相对路径（../../portal/src/...）或端的 workspace 包名（portal / portal/src/...），
// 前者必须解析成真实路径才判得准，这也是本规则留在 arch-check 而不是 ESLint 的原因。
const APP_SRC_BY_ID = new Map(
  WEB_APP_IDS.map((id) => [id, join(ROOT, "apps", id, "src")])
)
/** 三种引用形态都要认：`from "x"`（含 re-export）、`import("x")`、副作用 `import "x"`。 */
const IMPORT_SPEC_RE =
  /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g

for (const file of files) {
  const rel = toPosix(relative(ROOT, file))
  const ownAppId = rel.match(/^apps\/([^/]+)\//)?.[1]
  const content = readFileSync(file, "utf-8")
  const lines = content.split("\n")
  // 整文件匹配而非逐行：跨行的 import(\n "…"\n) 逐行扫会漏
  for (const m of content.matchAll(IMPORT_SPEC_RE)) {
    const spec = m[1] ?? m[2] ?? m[3]
    let targetAppId: string | undefined
    if (spec.startsWith(".")) {
      const resolved = toPosix(join(file, "..", spec))
      for (const [id, src] of APP_SRC_BY_ID) {
        if (resolved.startsWith(`${toPosix(src)}/`)) targetAppId = id
      }
    } else {
      const head = spec.split("/")[0]
      if (APP_SRC_BY_ID.has(head)) targetAppId = head
    }
    if (!targetAppId || targetAppId === ownAppId) continue
    const lineNo = content.slice(0, m.index).split("\n").length
    violations.push({
      rule: "no-cross-app-import",
      file: rel,
      line: lineNo,
      code: `${lines[lineNo - 1]?.trim()} —— 禁止 import 端 "${targetAppId}" 的源码；两端共用的代码请提升到 packages/ui 或 packages/web-core`,
    })
  }
}

// Rule 4: 页面文件必须在本端 App.tsx 中通过 React.lazy 引入（除 LoginPage）
for (const webSrc of WEB_SRC_ROOTS) {
  const appSrc = readFileSync(join(webSrc, "App.tsx"), "utf-8")
  const pageFiles = walk(join(webSrc, "pages")).filter((f) =>
    f.endsWith(".tsx")
  )
  for (const pageFile of pageFiles) {
    const base = basename(pageFile, ".tsx")
    // 跳过 LoginPage 与 index 类文件
    if (base === "LoginPage" || base.startsWith("_")) continue
    // 只关注顶层「Page」文件（子组件不算）
    if (!base.endsWith("Page")) continue
    // 允许两种引法：React.lazy(...) 或 lazy(...)
    const pathHint = toPosix(relative(webSrc, pageFile)).replace(/\.tsx$/, "")
    const lazyRe = new RegExp(
      `lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*["']@?/?${pathHint.replace(/\//g, "\\/")}["']`
    )
    const importedDirect = new RegExp(
      `import\\s+[A-Za-z]+\\s+from\\s+["']@\\/${pathHint.replace(/\//g, "\\/")}["']`
    )

    const lazyMatch = lazyRe.test(appSrc)
    const directMatch = importedDirect.test(appSrc)

    if (directMatch && !lazyMatch) {
      violations.push({
        rule: "page-must-lazy",
        file: toPosix(relative(ROOT, pageFile)),
        line: 1,
        code: `${base} 被直接 import，应使用 React.lazy()`,
      })
    }
  }
}

// Rule 5: 单文件行数棘轮（pages 下 .tsx + api modules 下 .ts）
// 行数口径与 `wc -l` 一致：按换行计行，末尾换行不额外多计一行（无末尾换行的最后一行计入）。
// 本文件所有基线都按此口径，勿改用 split("\n").length——后者对末尾换行的文件会多 1 行。
const MAX_LINES = 450

/**
 * 存量超长文件棘轮白名单：key 为相对仓库根目录的 posix 路径，value 为基线行数。
 * 「只许减不许增」由脚本双向强制：行数高于基线报 exceeded；低于基线也必须同步下调
 * 基线（否则基线会虚高、日后回涨到旧值仍能通过），降到 450 行以内须移除条目。
 * 条目对应文件删除/改名/移出扫描范围即视为失效，须移除。
 */
const LONG_FILE_RATCHET: Record<string, number> = {
  "apps/web/src/pages/OverlaysPage.tsx": 1024,
  "apps/web/src/pages/SystemSettingsPage.tsx": 857,
  "apps/web/src/pages/FormsPage.tsx": 562,
  "apps/web/src/pages/DataPage.tsx": 537,
}

/** 行数口径同 `wc -l`：末尾换行不额外计行；空文件为 0 行。 */
function countLines(file: string): number {
  const content = readFileSync(file, "utf-8")
  if (content === "") return 0
  const lines = content.split("\n")
  return content.endsWith("\n") ? lines.length - 1 : lines.length
}

const lineCheckFiles = [
  ...WEB_SRC_ROOTS.flatMap((src) =>
    walk(join(src, "pages")).filter((f) => f.endsWith(".tsx"))
  ),
  ...walk(API_MODULES).filter((f) => f.endsWith(".ts")),
]
const scannedRelPaths = new Set<string>()
for (const file of lineCheckFiles) {
  // key 统一 posix 形式，避免 Windows 下 relative() 返回反斜杠导致白名单不匹配
  const rel = relative(ROOT, file).replace(/\\/g, "/")
  scannedRelPaths.add(rel)
  const lineCount = countLines(file)
  const baseline = LONG_FILE_RATCHET[rel]

  if (baseline === undefined) {
    if (lineCount > MAX_LINES) {
      violations.push({
        rule: "file-too-long",
        file: rel,
        line: MAX_LINES + 1,
        code: `${lineCount} 行（上限 ${MAX_LINES} 行），${
          rel.startsWith("apps/api/")
            ? "请按 AGENTS.md「后端模块化」拆分：route 保持薄，业务下沉 service / 子模块"
            : "请按 AGENTS.md「页面拆分标准」拆到 components/ 或 hooks/"
        }`,
      })
    }
    continue
  }

  if (lineCount > baseline) {
    violations.push({
      rule: "overlong-ratchet-exceeded",
      file: rel,
      line: baseline + 1,
      code: `棘轮只许减不许增：当前 ${lineCount} 行 > 基线 ${baseline} 行`,
    })
  } else if (lineCount <= MAX_LINES) {
    violations.push({
      rule: "overlong-ratchet-stale",
      file: rel,
      line: 1,
      code: `已降到 ${MAX_LINES} 行阈值内（当前 ${lineCount} 行），请从 LONG_FILE_RATCHET 移除`,
    })
  } else if (lineCount < baseline) {
    violations.push({
      rule: "overlong-ratchet-unlowered",
      file: rel,
      line: 1,
      code: `当前 ${lineCount} 行已低于基线 ${baseline} 行：请把 LONG_FILE_RATCHET 基线同步下调为 ${lineCount}（棘轮只许减不许增）`,
    })
  }
}

// 白名单条目失效检查：文件已不存在或已不在扫描范围内
for (const [rel, baseline] of Object.entries(LONG_FILE_RATCHET)) {
  if (!scannedRelPaths.has(rel)) {
    violations.push({
      rule: "overlong-ratchet-missing",
      file: rel,
      line: 1,
      code: `白名单条目失效（文件不存在或不在扫描范围内），请移除（基线 ${baseline} 行）`,
    })
  }
}

// Rule 6: 业务模块规格书存在性守护（排除内置底座模块，要求每个业务模块存在 docs/specs/<name>.md）
// 仅检查文件存在性：确保不出现无规格书的黑盒模块，同时不强制纯 Bug 修复/样式微调去刷文档 diff。
const BUILTIN_API_MODULES = new Set(["auth", "user", "log", "notification"])
const SPECS_DIR = join(ROOT, "docs/specs")
if (existsSync(API_MODULES)) {
  for (const entry of readdirSync(API_MODULES)) {
    const full = join(API_MODULES, entry)
    if (!statSync(full).isDirectory()) continue
    if (BUILTIN_API_MODULES.has(entry)) continue
    const specPath = join(SPECS_DIR, `${entry}.md`)
    if (!existsSync(specPath)) {
      violations.push({
        rule: "module-spec-required",
        file: `apps/api/src/modules/${entry}`,
        line: 1,
        code: `缺少对应的业务规格书 docs/specs/${entry}.md（可由 gen:module 自动生成或基于 docs/specs/_template.md 创建）`,
      })
    }
  }
}

// Rule 8: 端身份不变量——注册表 id 必须与各端配置里的字面量一致。
// 漏改任一处都会静默串端：APP_ID 错 → VITE_APP_ID 错 → scopedStorageKey 退回裸键，
// 同一浏览器里两个端共用 auth-storage；name 错 → bun --filter <id> 找不到包。
// 这些是跨文件不变量（注册表 ⇄ 4 个配置文件），ESLint 单文件扫不到，故归本脚本。
const APP_ID_RE = /^const APP_ID = "([^"]+)"$/m
const VITEST_APP_ID_RE = /readWebApp\([^\n]*,\s*"([^"]+)"\s*\)/
for (const id of WEB_APP_IDS) {
  const appDir = join(ROOT, "apps", id)
  const rel = (file: string) => `apps/${id}/${file}`
  const report = (file: string, code: string) =>
    violations.push({
      rule: "web-app-identity-mismatch",
      file: rel(file),
      line: 1,
      code,
    })

  const pkgPath = join(appDir, "package.json")
  if (!existsSync(pkgPath)) {
    report("package.json", "文件缺失，无法校验端身份")
  } else {
    const name = (
      JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string }
    ).name
    if (name !== id) {
      report("package.json", `name 为 ${JSON.stringify(name)}，应为 "${id}"`)
    }
  }

  const vitePath = join(appDir, "vite.config.ts")
  if (!existsSync(vitePath)) {
    report("vite.config.ts", "文件缺失，无法校验端身份")
  } else {
    const matched = readFileSync(vitePath, "utf-8").match(APP_ID_RE)
    if (!matched) {
      report(
        "vite.config.ts",
        '未找到单行 `const APP_ID = "…"`，无法校验端身份'
      )
    } else if (matched[1] !== id) {
      report("vite.config.ts", `APP_ID 为 "${matched[1]}"，应为 "${id}"`)
    }
  }

  const vitestPath = join(appDir, "vitest.config.ts")
  if (!existsSync(vitestPath)) {
    report("vitest.config.ts", "文件缺失，无法校验端身份")
  } else {
    const matched = readFileSync(vitestPath, "utf-8").match(VITEST_APP_ID_RE)
    if (!matched) {
      report(
        "vitest.config.ts",
        '未找到单行 `readWebApp(…, "…")`，无法校验端身份'
      )
    } else if (matched[1] !== id) {
      report(
        "vitest.config.ts",
        `readWebApp 的 id 为 "${matched[1]}"，应为 "${id}"`
      )
    }
  }

  const tsconfigPath = join(appDir, "tsconfig.json")
  if (!existsSync(tsconfigPath)) {
    report("tsconfig.json", "文件缺失，无法校验端身份")
  } else {
    const tsBuildInfoFile = (
      JSON.parse(readFileSync(tsconfigPath, "utf-8")) as {
        compilerOptions?: { tsBuildInfoFile?: string }
      }
    ).compilerOptions?.tsBuildInfoFile
    // 只约束文件名唯一性，不约束目录——各端共用 .cache/tsc/ 但必须各写各的快照
    if (basename(tsBuildInfoFile ?? "") !== `${id}.tsbuildinfo`) {
      report(
        "tsconfig.json",
        `tsBuildInfoFile 为 ${JSON.stringify(tsBuildInfoFile)}，文件名应为 "${id}.tsbuildinfo"（各端共用快照会互相覆盖）`
      )
    }
  }
}

if (violations.length > 0) {
  console.error(`❌ 架构约束检查失败（${violations.length} 项）：\n`)
  const byRule = new Map<string, Violation[]>()
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, [])
    byRule.get(v.rule)!.push(v)
  }
  const ruleDesc: Record<string, string> = {
    "ui-no-direct-api":
      "UI 层禁止直接 import api 实例（@/lib/api 或 @workspace/web-core/lib/api），应封装到 services/",
    "ui-no-axios": "UI 层禁止直接 import axios（应封装到 services/）",
    "no-direct-sonner":
      "禁止直接 import sonner，请使用 @workspace/web-core/lib/toast",
    "no-cross-app-import":
      "各端之间禁止互相 import，共享包也不得 import 某个端的源码（共用代码提升到 packages/）",
    "page-must-lazy": "页面文件必须在 App.tsx 中通过 React.lazy() 引入",
    "file-too-long":
      "单文件超过 450 行，请按 AGENTS.md 拆分（web 走「页面拆分标准」，api 走「后端模块化」）",
    "overlong-ratchet-exceeded": "存量超长文件棘轮只许减不许增（已超出基线）",
    "overlong-ratchet-stale":
      "已降到 450 行阈值内，请从 LONG_FILE_RATCHET 移除",
    "overlong-ratchet-unlowered":
      "当前行数低于基线，请同步下调 LONG_FILE_RATCHET 基线（棘轮只许减）",
    "overlong-ratchet-missing": "LONG_FILE_RATCHET 白名单条目失效，请移除",
    "module-spec-required":
      "业务模块必须在 docs/specs/<name>.md 中维护对应的 5 要素规格书",
    "web-app-identity-mismatch":
      "端配置里的身份字面量必须与 web-apps.json 的 id 一致（漏改会静默串端或让 bun --filter 找不到包）",
  }
  for (const [rule, list] of byRule) {
    console.error(`▸ [${rule}] ${ruleDesc[rule]}`)
    for (const v of list) console.error(`   ${v.file}:${v.line}  ${v.code}`)
    console.error("")
  }
  process.exit(1)
}

console.log(
  `✅ 架构约束检查通过（${WEB_APP_IDS.length} 个端共扫描 ${files.length} 个文件；行数检查 ${lineCheckFiles.length} 个文件）`
)
