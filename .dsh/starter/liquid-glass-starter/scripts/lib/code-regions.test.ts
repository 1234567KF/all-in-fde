/**
 * code-regions 引擎单测。
 *
 * 覆盖两件事：
 * 1. 纯函数行为：4 种宿主语法的解析 / 剥离 / 去标记 / 容器收起 / 严格配对报错，
 *    以及「插入区块 → 剥离区块」逐字节往返（gen:module ⇄ remove:module 的底层保证）；
 * 2. 仓库区块完整性扫描（设计书 §3.4）：遍历受管目录与文件，确保模板维护者破坏标记时
 *    CI 立即失败，而不是等到某次 scaffold / remove:module 才静默失效。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "bun:test"

import {
  GROUP_REGION_PREFIX,
  listRegions,
  MODULE_REGION_PREFIX,
  parseRegions,
  RegionParseError,
  stripEmptyGroupRegions,
  stripRegions,
  unwrapRegions,
} from "./code-regions"

// ─── 4 种宿主语法解析 ────────────────────────────────────────────────────────

describe("parseRegions / listRegions：4 种宿主语法", () => {
  it("TS / JS：// #region id … // #endregion id", () => {
    const source = `const a = 1
// #region module:contract
const contract = 2
// #endregion module:contract
const b = 3
`
    expect(parseRegions(source)).toEqual([
      { id: "module:contract", startLine: 2, endLine: 4, depth: 0 },
    ])
    expect(listRegions(source)).toEqual(["module:contract"])
  })

  it("TS 允许缩进与 `//#region` 紧凑写法", () => {
    const source = `  //#region feature:demo
  const x = 1
  //#endregion feature:demo
`
    expect(listRegions(source)).toEqual(["feature:demo"])
  })

  it("JSX：{/* #region id */} … {/* #endregion id */}", () => {
    const source = `  <TopBar>
    {/* #region feature:notification */}
    <TopBarNotificationSlot />
    {/* #endregion feature:notification */}
  </TopBar>
`
    expect(listRegions(source)).toEqual(["feature:notification"])
    expect(stripRegions(source, "feature:notification")).toBe(
      "  <TopBar>\n  </TopBar>\n"
    )
  })

  it("Markdown：<!-- region:id --> … <!-- endregion:id -->", () => {
    const source = `# 标题
<!-- region:template-only -->
## 模板专属
<!-- endregion:template-only -->
正文
`
    expect(listRegions(source)).toEqual(["template-only"])
    expect(stripRegions(source, "template-only")).toBe("# 标题\n正文\n")
  })

  it("dotenv / shell：# region:id … # endregion:id", () => {
    const source = `A=1
# region:feature:notification
FEATURE_FLAG=true
# endregion:feature:notification
B=2
`
    expect(listRegions(source)).toEqual(["feature:notification"])
    expect(stripRegions(source, "feature:notification")).toBe("A=1\nB=2\n")
  })

  it("标记必须独占一行：行内夹杂其他字符不识别", () => {
    const source = `const s = "// #region module:fake"
// #region module:real 行尾注释
// #endregion module:real 行尾注释
/* #region module:block */
`
    expect(listRegions(source)).toEqual([])
  })

  it("无标记 / 空文件返回空数组", () => {
    expect(parseRegions("")).toEqual([])
    expect(parseRegions("const a = 1\n")).toEqual([])
  })

  it("同 id 多个顺序区块：全部识别（listRegions 含重复）", () => {
    const source = `// #region module:contract
const a = 1
// #endregion module:contract
const mid = 0
// #region module:contract
const b = 2
// #endregion module:contract
`
    expect(listRegions(source)).toEqual(["module:contract", "module:contract"])
    expect(parseRegions(source)).toEqual([
      { id: "module:contract", startLine: 1, endLine: 3, depth: 0 },
      { id: "module:contract", startLine: 5, endLine: 7, depth: 0 },
    ])
  })
})

// ─── 嵌套（不同 id 合法）─────────────────────────────────────────────────────

describe("嵌套区块", () => {
  const nested = `// #region feature:demo
outer
// #region feature:notification
inner
// #endregion feature:notification
outer2
// #endregion feature:demo
`

  it("不同 id 嵌套：depth 从 0 开始，按出现顺序返回", () => {
    expect(parseRegions(nested)).toEqual([
      { id: "feature:demo", startLine: 1, endLine: 7, depth: 0 },
      { id: "feature:notification", startLine: 3, endLine: 5, depth: 1 },
    ])
  })

  it("剥离内层只删内层，外层标记保留", () => {
    expect(stripRegions(nested, "feature:notification")).toBe(
      `// #region feature:demo
outer
outer2
// #endregion feature:demo
`
    )
  })

  it("剥离外层时内层内容一并消失", () => {
    expect(stripRegions(nested, "feature:demo")).toBe("")
  })
})

// ─── 严格配对：快速失败并带 1-based 行号 ────────────────────────────────────

describe("RegionParseError：严格配对失败", () => {
  function captureError(source: string): RegionParseError {
    try {
      listRegions(source)
    } catch (error) {
      if (error instanceof RegionParseError) return error
      throw error
    }
    throw new Error("预期抛出 RegionParseError，但解析成功了")
  }

  it("未闭合 → unclosed，行号指向开始的标记行", () => {
    const error = captureError(
      "const a = 1\n// #region module:contract\nconst b = 2\n"
    )
    expect(error.code).toBe("unclosed")
    expect(error.line).toBe(2)
    expect(error.name).toBe("RegionParseError")
  })

  it("多余闭合 → unexpected-close", () => {
    const error = captureError("const a = 1\n// #endregion module:contract\n")
    expect(error.code).toBe("unexpected-close")
    expect(error.line).toBe(2)
  })

  it("闭合 id 不匹配 → mismatched-close", () => {
    const error = captureError(
      "// #region module:contract\nbody\n// #endregion module:order\n"
    )
    expect(error.code).toBe("mismatched-close")
    expect(error.line).toBe(3)
    expect(error.message).toContain("module:order")
    expect(error.message).toContain("module:contract")
  })

  it("交叉嵌套（a 开、b 开、a 闭）→ mismatched-close", () => {
    const error = captureError(
      "// #region a\n// #region b\n// #endregion a\n// #endregion b\n"
    )
    expect(error.code).toBe("mismatched-close")
    expect(error.line).toBe(3)
  })

  it("同 id 自嵌套非法 → self-nested", () => {
    const error = captureError(
      "// #region module:contract\n// #region module:contract\nx\n// #endregion module:contract\n// #endregion module:contract\n"
    )
    expect(error.code).toBe("self-nested")
    expect(error.line).toBe(2)
  })

  it("错误信息包含行号与 id", () => {
    const error = captureError("// #region feature:orphan\nx\n")
    expect(error.message).toContain("第 1 行")
    expect(error.message).toContain("feature:orphan")
  })
})

// ─── stripRegions ────────────────────────────────────────────────────────────

describe("stripRegions", () => {
  it("目标 id 不存在 → 原样返回（不做任何空白规范化）", () => {
    const source = "a\n\n\nb\n"
    expect(stripRegions(source, "module:missing")).toBe(source)
  })

  it("删除区块后不残留多余空行", () => {
    const source = `head
// #region module:contract
const contract = 1
// #endregion module:contract
tail
`
    expect(stripRegions(source, "module:contract")).toBe("head\ntail\n")
  })

  it("一次删除多个同 id 区块", () => {
    const source = `one
// #region module:contract
a
// #endregion module:contract
two
// #region module:contract
b
// #endregion module:contract
three
`
    expect(stripRegions(source, "module:contract")).toBe("one\ntwo\nthree\n")
  })

  it("连续空行收敛为最多一个空行", () => {
    const source = `a


// #region module:contract
x
// #endregion module:contract
b
`
    expect(stripRegions(source, "module:contract")).toBe("a\n\nb\n")
  })

  it("原文件以换行结尾 → 结果恰好一个结尾换行", () => {
    const source =
      "head\n// #region module:contract\nx\n// #endregion module:contract\n"
    expect(stripRegions(source, "module:contract")).toBe("head\n")
  })

  it("原文件不以换行结尾 → 结果也不以换行结尾", () => {
    const source =
      "head\n// #region module:contract\nx\n// #endregion module:contract\ntail"
    expect(stripRegions(source, "module:contract")).toBe("head\ntail")
  })

  it("整文件删空 → 返回空字符串（不是换行）", () => {
    const source =
      "// #region module:contract\nx\n// #endregion module:contract\n"
    expect(stripRegions(source, "module:contract")).toBe("")
  })

  it("幂等：重复剥离结果不变", () => {
    const source =
      "a\n// #region module:contract\nx\n// #endregion module:contract\nb\n"
    const once = stripRegions(source, "module:contract")
    expect(stripRegions(once, "module:contract")).toBe(once)
  })

  it("CRLF 文件只删目标行，其余行保留原始 \\r", () => {
    const source =
      "a\r\n// #region module:contract\r\nx\r\n// #endregion module:contract\r\nb\r\n"
    expect(stripRegions(source, "module:contract")).toBe("a\r\nb\r\n")
  })

  it("CRLF 空行收敛：删除区块后连续空行收敛为一个空行（R1-A3）", () => {
    const source =
      "a\r\n\r\n// #region x\r\nbody\r\n// #endregion x\r\n\r\nb\r\n"
    expect(stripRegions(source, "x")).toBe("a\r\n\r\nb\r\n")
  })

  it("CRLF 末尾无换行：删除区块后不残留孤立 \\r（R1-A3）", () => {
    const source = "a\r\n// #region x\r\nbody\r\n// #endregion x"
    expect(stripRegions(source, "x")).toBe("a")
  })

  it("CRLF 整文件删空 → 返回空字符串", () => {
    const source = "// #region x\r\nbody\r\n// #endregion x\r\n"
    expect(stripRegions(source, "x")).toBe("")
  })
})

// ─── unwrapRegions ───────────────────────────────────────────────────────────

describe("unwrapRegions", () => {
  it("只删除标记行、保留内容", () => {
    const source = `head
// #region feature:notification
const keep = 1
// #endregion feature:notification
tail
`
    expect(unwrapRegions(source, "feature:notification")).toBe(
      "head\nconst keep = 1\ntail\n"
    )
  })

  it("目标 id 不存在 → 原样返回", () => {
    const source = "a\n\n\nb\n"
    expect(unwrapRegions(source, "feature:missing")).toBe(source)
  })

  it("嵌套时只去目标标记：外层去标记后内层标记仍在", () => {
    const source = `// #region feature:demo
outer
// #region feature:notification
inner
// #endregion feature:notification
// #endregion feature:demo
`
    expect(unwrapRegions(source, "feature:demo")).toBe(
      `outer
// #region feature:notification
inner
// #endregion feature:notification
`
    )
  })
})

// ─── 容器区块收起 ────────────────────────────────────────────────────────────

describe("stripEmptyGroupRegions", () => {
  it("容器内仍有 module:* 区块 → 原样返回", () => {
    const source = `// #region gen:group:Business
{
  items: [
    // #region module:contract
    { title: "合同" },
    // #endregion module:contract
  ],
}
// #endregion gen:group:Business
`
    expect(stripEmptyGroupRegions(source)).toBe(source)
  })

  it("容器内无任何 module:* 区块 → 整体删除并规范化空白", () => {
    const source = `head
// #region gen:group:Business
{
  items: [],
}
// #endregion gen:group:Business
tail
`
    expect(stripEmptyGroupRegions(source)).toBe("head\ntail\n")
  })

  it("多个容器：只收起空容器，保留仍有模块的容器", () => {
    const source = `// #region gen:group:Empty
// #endregion gen:group:Empty
// #region gen:group:Business
// #region module:contract
const c = 1
// #endregion module:contract
// #endregion gen:group:Business
`
    expect(stripEmptyGroupRegions(source)).toBe(
      `// #region gen:group:Business
// #region module:contract
const c = 1
// #endregion module:contract
// #endregion gen:group:Business
`
    )
  })

  it("没有容器区块 → 原样返回", () => {
    const source =
      "// #region module:contract\nx\n// #endregion module:contract\n"
    expect(stripEmptyGroupRegions(source)).toBe(source)
  })

  it("容器前缀常量与区块 id 契约一致", () => {
    expect(GROUP_REGION_PREFIX).toBe("gen:group:")
    expect(MODULE_REGION_PREFIX).toBe("module:")
  })
})

// ─── 往返：插入区块 → 剥离后逐字节还原（gen:module ⇄ remove:module）─────────

describe("插入 → 剥离逐字节往返", () => {
  it("appendSection 类（shared/index.ts、db/schema.ts）", () => {
    const section =
      "// #region module:contract\n// 合同类型\n// #endregion module:contract"
    const original = 'export { userSchema } from "./user.js"\n'
    const generated = original.replace(/\s+$/, "") + "\n\n" + section + "\n"

    expect(stripRegions(generated, "module:contract")).toBe(original)
  })

  it("insertAfterMarker 类（permissions / audit / query-keys / App lazy）", () => {
    const marker = "  // [gen:module:permissions] 注册新权限码（勿手改本行）"
    const original = `export const PERMISSIONS = {
  USER_VIEW: "user:view",
${marker}
} as const
`
    const block = `  // #region module:contract
  CONTRACT_VIEW: "contract:view",
  // #endregion module:contract
`
    // insertAfterMarker：整块插在锚点行之后（锚点行保留）
    const markerLineEnd = original.indexOf("\n", original.indexOf(marker)) + 1
    const generated =
      original.slice(0, markerLineEnd) + block + original.slice(markerLineEnd)

    expect(stripRegions(generated, "module:contract")).toBe(original)
  })

  it("insertBeforeMarker 类（App.tsx 路由，JSX 标记）", () => {
    const marker =
      "              {/* [gen:module:app-routes] 注册业务路由（勿手改本行） */}"
    const original = `            <Route path="/dashboard" element={<DashboardPage />} />
${marker}
          </Routes>
`
    const block = `              {/* #region module:contract */}
              <Route path="/contract" element={<ContractPage />} />
              {/* #endregion module:contract */}
`
    const lineStart = original.lastIndexOf("\n", original.indexOf(marker)) + 1
    const generated =
      original.slice(0, lineStart) + block + original.slice(lineStart)

    expect(stripRegions(generated, "module:contract")).toBe(original)
  })

  it("menu 首次生成：strip 模块区块 + 收起 Business 容器 → 还原原始菜单", () => {
    const marker =
      "  // [gen:module:menu-groups] 由 bun run gen:module 追加业务模块菜单分组（勿手改本行）"
    const original = `export const menuGroups: MenuGroup[] = [
  {
    label: "Overview",
    items: [{ title: "仪表盘", path: "/dashboard" }],
  },
${marker}
]
`
    const group = `  // #region gen:group:Business
  {
    label: "Business",
    items: [
      // #region module:contract
      { title: "合同", path: "/contract" },
      // #endregion module:contract
      // [gen:module:menu-items] 由 bun run gen:module 追加业务模块菜单项（勿手改本行）
    ],
  },
  // #endregion gen:group:Business
`
    const lineStart = original.lastIndexOf("\n", original.indexOf(marker)) + 1
    const generated =
      original.slice(0, lineStart) + group + original.slice(lineStart)

    const afterStrip = stripRegions(generated, "module:contract")
    expect(stripEmptyGroupRegions(afterStrip)).toBe(original)
  })
})

// ─── 仓库区块完整性扫描（设计书 §3.4）────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** 参与扫描的目录（相对仓库根）。 */
const SCAN_DIRS = ["apps", "packages", ".agents/skills", "docs/specs"]
/** 参与扫描的单文件。 */
// README.md 在真实 scaffold 产物里会被改名为 DESIGN_SYSTEM.md；两个都列为可选扫描目标。
const SCAN_FILES = [
  "AGENTS.md",
  "README.md",
  "DESIGN_SYSTEM.md",
  ".env.example",
  // 无扩展名，走单文件清单而不是 TEXT_EXTENSIONS；web-app:<id> 区块用 # 宿主语法
  "Dockerfile",
]
/** 只扫文本扩展名，避免把 sqlite / 图片等二进制当源码。 */
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".env",
  ".example",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
])
/** 依赖 / 构建产物 / 运行时数据目录不扫描。 */
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "out",
  "target",
])

function collectScannedFiles(): string[] {
  const files: string[] = []

  function walk(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      if (SKIP_DIRS.has(name)) continue
      const absolute = path.join(directory, name)
      const stats = statSync(absolute)
      if (stats.isDirectory()) {
        walk(absolute)
      } else if (stats.isFile() && TEXT_EXTENSIONS.has(path.extname(name))) {
        files.push(absolute)
      }
    }
  }

  for (const dir of SCAN_DIRS) {
    const absolute = path.join(REPO_ROOT, dir)
    try {
      if (statSync(absolute).isDirectory()) walk(absolute)
    } catch {
      // 生成项目 / 裁剪后的仓库可能没有该目录：跳过而不是失败
    }
  }
  for (const file of SCAN_FILES) {
    const absolute = path.join(REPO_ROOT, file)
    try {
      if (statSync(absolute).isFile()) files.push(absolute)
    } catch {
      // 同上
    }
  }
  return files
}

describe("仓库区块完整性扫描", () => {
  it("受管文本文件中的全部区块标记均严格配对", () => {
    const scannedFiles = collectScannedFiles()
    // 防止扫描器自身失效导致「0 个文件 → 永远通过」
    expect(scannedFiles.length).toBeGreaterThan(50)

    const errors: string[] = []
    for (const file of scannedFiles) {
      try {
        listRegions(readFileSync(file, "utf8"))
      } catch (error) {
        if (!(error instanceof RegionParseError)) throw error
        errors.push(`${path.relative(REPO_ROOT, file)}: ${error.message}`)
      }
    }

    expect(errors).toEqual([])
  })
})

// 生成项目（已剥离 Tier 1 特性）会保留本测试文件并运行 `bun run test:scripts`：
// AGENTS.md 的模板专属区块被剥、README.md 被改名为 DESIGN_SYSTEM.md、.env.example
// 的 feature 区块被删都是合法终态，因此这里**不绑定仓库当前内容**——语法识别能力由
// 上方 4 种宿主语法的 inline fixture 覆盖，仓库文件只做「存在即可合法解析」的弱断言。
describe("仓库既有文件（存在则必须可合法解析）", () => {
  const REPO_FILES = [
    "AGENTS.md",
    "README.md",
    "DESIGN_SYSTEM.md",
    ".env.example",
    "Dockerfile",
    "docs/specs/_template.md",
  ]

  it("存在的文件调用 listRegions 不抛错（无区块 / 区块已被剥离均合法）", () => {
    let checked = 0
    for (const relativePath of REPO_FILES) {
      const absolute = path.join(REPO_ROOT, relativePath)
      if (!existsSync(absolute)) continue
      checked += 1
      expect(() => listRegions(readFileSync(absolute, "utf8"))).not.toThrow()
    }
    expect(checked).toBeGreaterThan(0)
  })
})
