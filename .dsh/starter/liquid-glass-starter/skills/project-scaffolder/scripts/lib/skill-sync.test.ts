import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"

import { diffSkillTrees, isEmptyDiff, syncSkillTree } from "./skill-sync"

let tmp: string
let source: string
let target: string

function write(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, "utf8")
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8")
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-sync-"))
  source = path.join(tmp, "source")
  target = path.join(tmp, "target")
  fs.mkdirSync(source, { recursive: true })
  fs.mkdirSync(target, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("diffSkillTrees", () => {
  it("目标为空 → 源侧全部计入 added", () => {
    write(source, "SKILL.md", "# skill")
    write(source, "scripts/lib/a.ts", "export const a = 1")

    const diff = diffSkillTrees(source, target)
    expect(diff.added).toEqual(["SKILL.md", "scripts/lib/a.ts"])
    expect(diff.changed).toEqual([])
    expect(diff.removed).toEqual([])
    expect(isEmptyDiff(diff)).toBe(false)
  })

  it("两侧逐字节一致 → 三类均空", () => {
    write(source, "SKILL.md", "# skill")
    write(source, "templates/go/main.go.template", "package main")
    write(target, "SKILL.md", "# skill")
    write(target, "templates/go/main.go.template", "package main")

    expect(isEmptyDiff(diffSkillTrees(source, target))).toBe(true)
  })

  it("单文件内容改动 → 只进 changed", () => {
    write(source, "SKILL.md", "new")
    write(source, "scripts/scaffold.ts", "same")
    write(target, "SKILL.md", "old")
    write(target, "scripts/scaffold.ts", "same")

    const diff = diffSkillTrees(source, target)
    expect(diff.changed).toEqual(["SKILL.md"])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  it("目标多出上游已删的孤儿 → 进 removed", () => {
    write(source, "scripts/lib/web-app.ts", "export const a = 1")
    write(target, "scripts/lib/web-app.ts", "export const a = 1")
    write(target, "scripts/lib/long-file-ratchet.ts", "// 上游已删除")

    expect(diffSkillTrees(source, target).removed).toEqual([
      "scripts/lib/long-file-ratchet.ts",
    ])
  })

  it("目标目录不存在 → 等价于空目标，不抛错", () => {
    write(source, "SKILL.md", "# skill")
    const missing = path.join(tmp, "nope")

    expect(diffSkillTrees(source, missing).added).toEqual(["SKILL.md"])
  })
})

describe("syncSkillTree", () => {
  it("覆盖改动 + 新增嵌套目录 + 物理删除孤儿及其空目录", () => {
    write(source, "SKILL.md", "new")
    write(source, "scripts/lib/web-app.ts", "export const a = 1")
    write(target, "SKILL.md", "old")
    write(target, "scripts/lib/long-file-ratchet.ts", "// 孤儿")

    const diff = syncSkillTree(source, target)
    expect(diff.changed).toEqual(["SKILL.md"])
    expect(diff.added).toEqual(["scripts/lib/web-app.ts"])
    expect(diff.removed).toEqual(["scripts/lib/long-file-ratchet.ts"])

    expect(read(target, "SKILL.md")).toBe("new")
    expect(read(target, "scripts/lib/web-app.ts")).toBe("export const a = 1")
    expect(
      fs.existsSync(path.join(target, "scripts/lib/long-file-ratchet.ts"))
    ).toBe(false)
    // 孤儿是 lib/ 下唯一文件时，空目录也要清掉
    write(target, "only/orphan.ts", "x")
    syncSkillTree(source, target)
    expect(fs.existsSync(path.join(target, "only"))).toBe(false)
    // 技能根自身必须保留
    expect(fs.existsSync(target)).toBe(true)
  })

  it("幂等：同步后再 diff 为空，再同步一次不产生任何变更", () => {
    write(source, "SKILL.md", "new")
    write(source, "references/ci-guide.md", "guide")
    write(target, "SKILL.md", "old")
    write(target, "stale.ts", "x")

    syncSkillTree(source, target)
    expect(isEmptyDiff(diffSkillTrees(source, target))).toBe(true)

    const second = syncSkillTree(source, target)
    expect(isEmptyDiff(second)).toBe(true)
  })

  it("路径含空格与中文 → 正常工作", () => {
    const spacedSource = path.join(tmp, "源 目录")
    const spacedTarget = path.join(tmp, "目标 目录")
    fs.mkdirSync(spacedSource, { recursive: true })
    fs.mkdirSync(spacedTarget, { recursive: true })
    write(spacedSource, "references/_ci 指南.md", "新")
    write(spacedTarget, "references/_ci 指南.md", "旧")

    expect(diffSkillTrees(spacedSource, spacedTarget).changed).toEqual([
      "references/_ci 指南.md",
    ])
    syncSkillTree(spacedSource, spacedTarget)
    expect(read(spacedTarget, "references/_ci 指南.md")).toBe("新")
  })
})