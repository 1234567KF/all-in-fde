import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "bun:test"

import {
  isExcludedFromTemplate,
  isTemplateDocPath,
  stripDashboardPreviewImage,
  stripTemplateOnlyMarkdownRegions,
  TEMPLATE_ONLY_REF_PREFIXES,
} from "./template-copy"

// lib → scripts → project-scaffolder → skills → 仓库根
const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

describe("docs 白名单：只有认证指南与规格书模板进入生成项目", () => {
  it("放行 docs 目录自身与白名单条目（含子目录）", () => {
    for (const rel of [
      "docs",
      "docs/auth.md",
      "docs/specs",
      "docs/specs/_template.md",
      "docs/specs/_archived/contract.md",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(false)
    }
  })

  it("排除模板内部设计书 / 已知问题 / 截图", () => {
    for (const rel of [
      "docs/modular-architecture-design.md",
      "docs/multi-web-apps-lite.md",
      "docs/known-issues-flat-templates.md",
      "docs/dashboard-preview.png",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(true)
    }
  })

  it("默认拒绝：新增内部文档与历史死条目都不需要登记即被排除", () => {
    for (const rel of [
      "docs/ai-native-enhancement-plan.md",
      "docs/brand-new-internal-design.md",
      "docs/requirements/v1.0/prd.md",
      "docs/nested/deep/notes.md",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(true)
    }
  })
})

describe("模板专属文件：规划表 / 部署配置 / 技能目录不复制", () => {
  it("排除 ROADMAP.md，但保留生成项目要用的根文档", () => {
    expect(isExcludedFromTemplate("ROADMAP.md")).toBe(true)
    for (const rel of ["AGENTS.md", "README.md", "DESIGN.md", "WORKFLOW.md"]) {
      expect(isExcludedFromTemplate(rel)).toBe(false)
    }
  })

  it("排除 self-deploy 与 CI 文件（由 stampCi 按项目名注入）", () => {
    for (const rel of [
      "compose.self.yml",
      "compose.yml",
      "compose.test.yml",
      "compose.preprod.yml",
      "Dockerfile",
      ".gitlab-ci.yml",
      ".dockerignore",
      "ci-tools",
      "ci-tools/check.sh",
      "deploy.sh",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(true)
    }
  })

  it("排除技能目录与团队目录，但不误伤别处同名目录", () => {
    for (const rel of [
      "skills",
      "skills/project-scaffolder/SKILL.md",
      ".team",
      ".team/impl-plan.md",
      "skills.json",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(true)
    }
    expect(isExcludedFromTemplate("apps/web/skills")).toBe(false)
    expect(isExcludedFromTemplate("apps/web/skills/foo.ts")).toBe(false)
  })
})

describe("产物模式：依赖 / 构建缓存 / 本地数据库不复制", () => {
  it("按 basename 在任意层级排除依赖与产物目录", () => {
    for (const rel of [
      "node_modules",
      "apps/web/node_modules",
      "dist",
      "apps/web/dist",
      ".eslintcache",
      "db-bootstrap",
      "uploads",
      "coverage",
      ".nyc_output",
      ".turbo",
      ".vite",
      ".gemini",
      ".DS_Store",
      "bun.lockb",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(true)
    }
  })

  it("排除本地 SQLite / Bun 临时产物 / 临时目录与 api 数据目录", () => {
    for (const rel of [
      "apps/api/data",
      "apps/api/data/app.db",
      "app.db",
      "app.db-wal",
      "app.db-shm",
      "app.sqlite",
      "app.sqlite-journal",
      ".18e52dbdacfbdff9-00000000.bun-build",
      ".tmp-init-gen",
      ".tmp-check",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(true)
    }
  })

  it("不误伤源码里的 db 目录与 schema 文件", () => {
    for (const rel of [
      "apps/api/src/db",
      "apps/api/src/db/schema.ts",
      "apps/api/src/db/bootstrap.ts",
      "apps/api/drizzle",
      "bun.lock",
      ".env.example",
    ]) {
      expect(isExcludedFromTemplate(rel)).toBe(false)
    }
  })
})

describe("路径归一化", () => {
  it("根自身恒不排除，否则递归复制无法起步", () => {
    expect(isExcludedFromTemplate("")).toBe(false)
  })

  it("Windows 反斜杠与 POSIX 等价", () => {
    expect(isExcludedFromTemplate("docs\\modular-architecture-design.md")).toBe(
      true
    )
    expect(isExcludedFromTemplate("apps\\api\\data")).toBe(true)
    expect(isExcludedFromTemplate("docs\\auth.md")).toBe(false)
    expect(isExcludedFromTemplate("docs\\specs\\_template.md")).toBe(false)
  })
})

describe("复制后变换纯函数", () => {
  it("剥离 template-only 区块并收敛连续空行", () => {
    const source = [
      "# 标题",
      "",
      "<!-- region:template-only -->",
      "模板专属规则",
      "<!-- endregion:template-only -->",
      "",
      "",
      "正文",
      "",
    ].join("\n")
    expect(stripTemplateOnlyMarkdownRegions(source)).toBe("# 标题\n\n正文\n")
  })

  it("无区块时原样返回", () => {
    const source = "# 标题\n\n正文\n"
    expect(stripTemplateOnlyMarkdownRegions(source)).toBe(source)
  })

  it("删除仪表盘截图引用行及其后空行，且幂等", () => {
    const source =
      "简介段落\n\n![Dashboard Preview](docs/dashboard-preview.png)\n\n> 规范\n"
    const expected = "简介段落\n\n> 规范\n"
    expect(stripDashboardPreviewImage(source)).toBe(expected)
    expect(stripDashboardPreviewImage(expected)).toBe(expected)
  })

  it("无截图引用时原样返回", () => {
    const source = "简介段落\n\n> 规范\n"
    expect(stripDashboardPreviewImage(source)).toBe(source)
  })
})

// ── 真实仓库守卫：排除策略与文档引用不得 drift ──────────────────────────────

/** 只扫描文本文件；二进制（png / lockb / db）与构建缓存不参与引用检查。 */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".sh",
  ".sql",
  ".txt",
  ".example",
])

/**
 * 遍历真实模板，按排除策略分成「会被复制」与「被排除的文档」两组。
 * 目录命中排除即整棵剪枝，因此不会走进 node_modules / .git。
 */
function partitionTemplate(): { copied: string[]; excludedDocs: string[] } {
  const copied: string[] = []
  const excludedDocs: string[] = []

  const visit = (rel: string): void => {
    const absolute = rel === "" ? REPO_ROOT : path.join(REPO_ROOT, rel)
    if (fs.statSync(absolute).isDirectory()) {
      if (rel !== "" && isExcludedFromTemplate(rel)) return
      for (const entry of fs.readdirSync(absolute)) {
        visit(rel === "" ? entry : `${rel}/${entry}`)
      }
      return
    }
    if (isExcludedFromTemplate(rel)) {
      if (isTemplateDocPath(rel)) excludedDocs.push(rel)
      return
    }
    copied.push(rel)
  }

  visit("")
  return { copied, excludedDocs }
}

/** 模拟 scaffold 复制后对根文档做的变换（README 稍后改名 DESIGN_SYSTEM.md）。 */
function copiedContent(rel: string): string {
  const raw = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")
  if (rel !== "AGENTS.md" && rel !== "README.md") return raw
  const stripped = stripTemplateOnlyMarkdownRegions(raw)
  return rel === "README.md" ? stripDashboardPreviewImage(stripped) : stripped
}

describe("真实仓库：被排除的模板内部文档不得留下断链引用", () => {
  it("遍历起点正确且守卫本身有效（确实存在被排除的文档）", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "AGENTS.md"))).toBe(true)
    const { copied, excludedDocs } = partitionTemplate()
    expect(copied).toContain("docs/auth.md")
    expect(copied).toContain("docs/specs/_template.md")
    expect(copied).not.toContain("ROADMAP.md")
    expect(excludedDocs).toContain("docs/modular-architecture-design.md")
    expect(excludedDocs).toContain("docs/dashboard-preview.png")
    expect(excludedDocs).toContain("ROADMAP.md")
  })

  it("任何会被复制的文件都不引用被排除的文档或团队目录", () => {
    const { copied, excludedDocs } = partitionTemplate()
    // 禁用引用实时推导：新增内部文档一旦被引用即报错，无需回来改名单。
    const forbidden = [...excludedDocs, ...TEMPLATE_ONLY_REF_PREFIXES]

    const violations: string[] = []
    for (const rel of copied) {
      if (!TEXT_EXTENSIONS.has(path.extname(rel))) continue
      const content = copiedContent(rel)
      for (const ref of forbidden) {
        if (content.includes(ref)) violations.push(`${rel} → ${ref}`)
      }
    }
    expect(violations).toEqual([])
  })
})
