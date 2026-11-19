// 模板 → 生成项目的复制排除策略（scaffold 与守卫测试共用的唯一事实源）。
//
// 文档走**白名单**而不是黑名单：模板仓库的 docs/ 里绝大多数是内部设计书 / 已知问题 /
// 规划，只有认证扩展指南与规格书模板对生成项目有意义。黑名单漏一条就静默泄漏一份
// 无关文档（ROADMAP.md 曾经如此），白名单漏一条只是少带一份文档，方向安全。
//
// 纯函数零依赖模块，不读文件系统：路径一律「模板仓库根相对」，Windows 反斜杠先归一化。

/** 按 basename 排除（任意层级）：依赖 / 构建产物 / 模板专属部署与规划文件。 */
export const TEMPLATE_EXCLUDED_BASENAMES = new Set([
  ".git",
  "node_modules",
  ".gemini",
  "dist",
  "bun.lockb",
  ".DS_Store",
  "skills.json",
  ".team",
  // 模板自身的无记忆部署配置（tmpfs）；生成项目走 compose.test.yml 持久卷 + 迁移链
  "compose.self.yml",
  // CI 文件由 stampCi() 按项目名注入（--include-ci / --mode add-ci），不能逐字节复制
  ".gitlab-ci.yml",
  "Dockerfile",
  "ci-tools",
  "deploy.sh",
  "compose.yml",
  "compose.test.yml",
  "compose.preprod.yml",
  ".dockerignore",
  // 模板自己的后续规划表，与生成项目无关（且状态早已过期）
  "ROADMAP.md",
])

/** 只按根相对路径排除的目录（basename 同名但在别处的目录不受影响）。 */
const TEMPLATE_EXCLUDED_ROOT_PATHS = ["tools", "apps/api/data"]

/** docs/ 下唯一允许进入生成项目的条目；其余一律排除。 */
const DOCS_KEPT = ["docs/auth.md", "docs/specs"]

/** 本地运行产物：按 basename 命中即排除，不逐个路径枚举。 */
const ARTIFACT_BASENAMES = new Set([
  ".eslintcache",
  "db-bootstrap",
  "uploads",
  "coverage",
  ".nyc_output",
  ".turbo",
  ".vite",
])

/** 本地 SQLite 文件、Bun 临时编译产物、临时生成目录（.tmp-init-gen / .tmp-check 等）。 */
const ARTIFACT_NAME_PATTERNS = [
  /\.db(-shm|-wal)?$/,
  /\.sqlite(-journal)?$/,
  /\.bun-build$/,
  /^\.tmp[-.]/,
]

/** 目录 / 文件是否被 docs 白名单放行；rel 为归一化后的根相对路径。 */
function isDocKept(rel: string): boolean {
  return DOCS_KEPT.some((kept) => rel === kept || rel.startsWith(`${kept}/`))
}

/**
 * 该根相对路径是否排除在复制之外（目录与文件同一判据，便于 cpSync filter 直接复用）。
 *
 * 根自身（空字符串）恒不排除，否则递归复制无法起步。
 */
export function isExcludedFromTemplate(relPath: string): boolean {
  const rel = relPath.replaceAll("\\", "/")
  if (rel === "") return false

  // 逐层判定而不是只看末段：调用方可能直接询问深层路径（cpSync filter / 守卫测试），
  // 不一定先经过父目录剪枝，被排除目录的子孙必须同样判为排除。
  for (const segment of rel.split("/")) {
    if (TEMPLATE_EXCLUDED_BASENAMES.has(segment)) return true
    if (ARTIFACT_BASENAMES.has(segment)) return true
    if (ARTIFACT_NAME_PATTERNS.some((pattern) => pattern.test(segment))) {
      return true
    }
  }

  if (
    TEMPLATE_EXCLUDED_ROOT_PATHS.some(
      (excluded) => rel === excluded || rel.startsWith(`${excluded}/`)
    )
  ) {
    return true
  }

  // docs 目录本身要放行才能继续向下递归，白名单只作用于其子条目。
  if (rel === "docs") return false
  if (rel.startsWith("docs/") && !isDocKept(rel)) return true

  return false
}

/**
 * 守卫测试用：模板内部文档的引用前缀。
 *
 * `.team/` 是团队实施计划目录，早已不在仓库里，但历史注释仍会引用它——无法从
 * 「现存且被排除的文件」推导，只能显式登记。其余禁用引用由测试按排除策略实时推导，
 * 新增内部文档无需改这里。
 */
export const TEMPLATE_ONLY_REF_PREFIXES = [".team/"]

/** 该路径是否属于「文档类」（守卫测试只检查文档断链，不检查 Dockerfile 等合法引用）。 */
export function isTemplateDocPath(relPath: string): boolean {
  const rel = relPath.replaceAll("\\", "/")
  if (rel.startsWith("docs/")) return true
  return !rel.includes("/") && rel.endsWith(".md")
}

/**
 * 剥离 Markdown 里的 `template-only` 区块（模板仓库专属规则段）。
 * 整段删除后常留下连续空行，收敛成最多一个空行。
 */
export function stripTemplateOnlyMarkdownRegions(source: string): string {
  return source
    .replace(
      /<!-- region:template-only -->[\s\S]*?<!-- endregion:template-only -->\n?/g,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
}

/**
 * 删掉设计参考文档里的模板 demo 仪表盘截图引用。
 *
 * 该 png 被 docs 白名单排除，引用行必须一并删除否则生成项目断图；连同其后空行
 * 一起删，保持 prettier 幂等形态。
 */
export function stripDashboardPreviewImage(source: string): string {
  return source.replace(
    /^!\[Dashboard Preview\]\(docs\/dashboard-preview\.png\)\n\n?/m,
    ""
  )
}
