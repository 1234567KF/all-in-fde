/**
 * `bun run remove:web --id <id>` —— 对称卸载一个 Web 端。
 *
 * 与 `scripts/add-web.ts` 的 addWebApp 成对：那边写入的 `web-app:<id>` 区块由这里
 * stripRegions 剥离，区块 id 与注册文件清单是两份实现之间唯一的契约，改动必须同步
 * （往返一致性由 remove-web.test.ts 覆盖）。
 *
 * 边界：
 *   - 默认端 `web` 不可删除（base "/" 的宿主，删了整个项目就没有入口）；
 *   - 删除前做反向引用预检：其他端 / 共享包 import 本端，或准入权限码仍被
 *     `ROLE_PERMISSIONS` 等区块外代码引用 → 终止并列出位置；
 *   - 只删端自己的目录与注册区块，不动数据库、不动其他端的业务代码。
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import { formatDirtyWorkspaceHint, getDirtyPaths } from "./gen-module/remove"
import { listRegions, parseRegions, stripRegions } from "./lib/code-regions"
import { pruneMissingLongFileRatchet } from "./lib/long-file-ratchet"
import { DEFAULT_WEB_APP_ID, readWebApps, type WebApp } from "./lib/web-apps"

/** 端注册区块 id 前缀（与 add-web.ts 的 REGION_PREFIX 一致） */
const REGION_PREFIX = "web-app:"
/** 可能含 web-app:<id> 区块的注册文件 */
const REGION_FILES = ["packages/shared/src/permissions.ts", "Dockerfile"]
const REGISTRY_FILE = "web-apps.json"

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"])
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".cache",
  ".git",
  "drizzle",
])

export interface WebAppReferenceHit {
  relPath: string
  line: number
  kind: "import" | "permission"
  text: string
}

export interface RemoveWebOptions {
  root: string
  id: string
  dryRun?: boolean
  /** 跳过未提交改动预检 */
  force?: boolean
}

export interface RemoveWebResult {
  id: string
  deletedDir: string
  modifiedFiles: string[]
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/")
}

function permissionKeyOf(id: string): string {
  return `APP_${id.toUpperCase().replaceAll("-", "_")}`
}

function walkCodeFiles(root: string, relDir: string): string[] {
  let entries
  try {
    entries = readdirSync(path.join(root, relDir), { withFileTypes: true })
  } catch {
    return []
  }
  const results: string[] = []
  for (const entry of entries) {
    const relPath = `${relDir}/${entry.name}`
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      results.push(...walkCodeFiles(root, relPath))
      continue
    }
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(relPath)
    }
  }
  return results
}

/** 三种引用形态都要认：`from "x"`（含 re-export）、`import("x")`、副作用 `import "x"`。 */
const IMPORT_SPEC_RE =
  /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g

/**
 * 反向引用预检：区块外是否还有代码依赖本端。
 *
 * 本端 `web-app:<id>` 注册区块内的引用按行范围跳过（属自身归属，不算反向引用），
 * 而 `ROLE_PERMISSIONS` 里手工加的授权会如实命中。行号一律按原文计算。
 */
export function findWebAppReverseReferences(
  root: string,
  id: string
): WebAppReferenceHit[] {
  const regionId = `${REGION_PREFIX}${id}`
  const appPrefix = `apps/${id}/`
  const permissionKey = permissionKeyOf(id)
  const permissionRe = new RegExp(`\\b${permissionKey}\\b|["']app:${id}["']`)
  const hits: WebAppReferenceHit[] = []

  for (const relPath of [
    ...walkCodeFiles(root, "apps"),
    ...walkCodeFiles(root, "packages"),
  ]) {
    // 只跳过被删端自己。api 不能 import 某个端（no-cross-app-import），但**可以**引用
    // 准入码 PERMISSIONS.APP_<ID>——跳过它会让删端剥掉权限定义后后端编译失败。
    if (relPath.startsWith(appPrefix)) continue
    const absolute = path.join(root, relPath)
    let content: string
    try {
      content = readFileSync(absolute, "utf8")
    } catch {
      continue
    }
    // 扫原文而不是剥离后的文本：剥离会让行号前移，报给用户的位置就是错的。
    // 本端注册区块内的引用属自身归属，按行范围跳过即可。
    const ownRegions = parseRegions(content).filter((r) => r.id === regionId)
    const inOwnRegion = (line: number) =>
      ownRegions.some((r) => line >= r.startLine && line <= r.endLine)
    const lines = content.split("\n")

    for (const match of content.matchAll(IMPORT_SPEC_RE)) {
      const spec = match[1] ?? match[2] ?? match[3]
      let targetAppId: string | null = null
      if (spec.startsWith(".")) {
        const resolved = toPosix(path.join(path.dirname(relPath), spec))
        if (resolved.startsWith(appPrefix)) targetAppId = id
      } else if (spec.split("/")[0] === id) {
        targetAppId = id
      }
      if (targetAppId !== id) continue
      const line = content.slice(0, match.index).split("\n").length
      if (inOwnRegion(line)) continue
      hits.push({
        relPath,
        line,
        kind: "import",
        text: lines[line - 1]?.trim() ?? spec,
      })
    }

    for (let i = 0; i < lines.length; i++) {
      if (inOwnRegion(i + 1)) continue
      if (!permissionRe.test(lines[i])) continue
      hits.push({
        relPath,
        line: i + 1,
        kind: "permission",
        text: lines[i].trim(),
      })
    }
  }
  return hits
}

export function formatWebAppReferenceHits(
  id: string,
  hits: readonly WebAppReferenceHit[]
): string {
  const limit = 40
  const shown = hits.slice(0, limit)
  const lines = [
    `删除端 ${id} 前发现 ${hits.length} 处反向引用（区块外代码仍依赖该端，删除后会编译失败）：`,
    ...shown.map(
      (hit) => `  - ${hit.relPath}:${hit.line}  [${hit.kind}]  ${hit.text}`
    ),
  ]
  if (hits.length > limit)
    lines.push(`  … 另有 ${hits.length - limit} 处未列出`)
  lines.push("", "请先解除这些引用（或把对应代码搬进该端 / 共享包）后重试。")
  return lines.join("\n")
}

/** 删除端目录 + 注册表条目 + web-app:<id> 区块；不跑 install / 格式化。 */
export function removeWebApp(opts: RemoveWebOptions): RemoveWebResult {
  const { root, id } = opts
  if (!existsSync(path.join(root, REGISTRY_FILE))) {
    throw new Error(`缺少 ${REGISTRY_FILE}：当前目录不是支持多端的项目根。`)
  }
  if (id === DEFAULT_WEB_APP_ID) {
    throw new Error(
      `默认端 "${DEFAULT_WEB_APP_ID}" 不允许删除（base "/" 的宿主）。`
    )
  }
  const apps = readWebApps(root)
  const entry = apps.find((app) => app.id === id)
  if (!entry) {
    throw new Error(
      `web-apps.json 中没有端 "${id}"，现有端：${apps.map((a) => a.id).join(", ")}`
    )
  }

  const hits = findWebAppReverseReferences(root, id)
  if (hits.length > 0) {
    throw new Error(formatWebAppReferenceHits(id, hits))
  }

  const appDir = `apps/${id}`
  const regionFiles = REGION_FILES.filter((rel) => {
    const file = path.join(root, rel)
    if (!existsSync(file)) return false
    return listRegions(readFileSync(file, "utf8")).includes(
      `${REGION_PREFIX}${id}`
    )
  })
  const affected = [appDir, REGISTRY_FILE, ...regionFiles]
  if (!opts.force) {
    const dirty = getDirtyPaths(root, affected)
    if (dirty.length > 0) {
      throw new Error(
        `以下路径有未提交改动：\n${dirty.map((l) => `  ${l}`).join("\n")}${formatDirtyWorkspaceHint(dirty)}`
      )
    }
  }

  if (opts.dryRun) {
    return {
      id,
      deletedDir: appDir,
      modifiedFiles: [REGISTRY_FILE, ...regionFiles],
    }
  }

  rmSync(path.join(root, appDir), { recursive: true, force: true })
  // tsc 增量缓存留在根 .cache 下，不随端目录删除；留着会让下次 typecheck 复用已删端的旧结果
  rmSync(path.join(root, ".cache", "tsc", `${id}.tsbuildinfo`), { force: true })

  const remaining: WebApp[] = apps.filter((app) => app.id !== id)
  writeFileSync(
    path.join(root, REGISTRY_FILE),
    `${JSON.stringify({ apps: remaining }, null, 2)}\n`,
    "utf8"
  )

  for (const rel of regionFiles) {
    const file = path.join(root, rel)
    writeFileSync(
      file,
      stripRegions(readFileSync(file, "utf8"), `${REGION_PREFIX}${id}`),
      "utf8"
    )
  }

  // 端页面可能在 LONG_FILE_RATCHET 里有条目，删页后必须剪枝，否则 arch:check 报缺失
  pruneMissingLongFileRatchet(root)

  return {
    id,
    deletedDir: appDir,
    modifiedFiles: [REGISTRY_FILE, ...regionFiles],
  }
}

function runCli(): void {
  const argv = process.argv.slice(2)
  const params: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      params[argv[i].slice(2)] = next
      i++
    } else {
      params[argv[i].slice(2)] = "true"
    }
  }
  const id = params["id"]
  if (!id) {
    console.error(
      "用法：bun run remove:web --id <id> [--dry-run] [--force] [--skip-install]"
    )
    process.exit(1)
  }

  const root = process.cwd()
  let result: RemoveWebResult
  try {
    result = removeWebApp({
      root,
      id,
      dryRun: params["dry-run"] === "true",
      force: params["force"] === "true",
    })
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`)
    process.exit(1)
  }

  if (params["dry-run"] === "true") {
    console.log(`🔎 dry-run：将删除 ${result.deletedDir}/`)
    for (const rel of result.modifiedFiles) console.log(`   将改写 ${rel}`)
    return
  }

  console.log(`🗑️  已删除 ${result.deletedDir}/`)
  for (const rel of result.modifiedFiles) console.log(`   ✓ ${rel}`)

  if (params["skip-install"] !== "true") {
    console.log("\n📦 同步依赖（bun install）...")
    const install = spawnSync(process.execPath, ["install"], {
      cwd: root,
      stdio: "inherit",
    })
    if (install.status !== 0) {
      console.error("❌ bun install 失败，端已删除但锁文件未同步。")
      console.error(`   请手动执行：cd "${root}" && bun install`)
      process.exit(1)
    }
  }

  console.log(`\n🎉 端 "${id}" 已卸载。建议跑一次 bun run check 确认门禁。`)
}

if (import.meta.main) {
  runCli()
}
