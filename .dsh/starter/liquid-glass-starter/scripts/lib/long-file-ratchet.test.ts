/**
 * `LONG_FILE_RATCHET` 剪枝与新增的单测。
 *
 * 只有一份实现：`scripts/lib/long-file-ratchet.ts`（remove:module / remove:web /
 * add:web 与 scaffold 共用——scaffold 动态 import 目标项目这一份，不再自带副本）。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "bun:test"

import {
  pruneMissingLongFileRatchet,
  readLongFileRatchetEntries,
  upsertLongFileRatchetEntries,
} from "./long-file-ratchet"

interface Fixture {
  name: string
  /** LONG_FILE_RATCHET 条目（相对路径 → 基线行数）。 */
  entries?: Record<string, number>
  /** 这些文件会在临时 root 中真实创建。 */
  existingFiles?: string[]
  /** 原始 arch-check.ts 内容；`null` 表示不创建 scripts/arch-check.ts。 */
  archCheckText?: string | null
}

const FIXTURES: Fixture[] = [
  {
    name: "部分条目失效（保留存在文件、删除失效条目）",
    entries: {
      "apps/web/src/pages/Existing.tsx": 1012,
      "apps/web/src/pages/Gone.tsx": 853,
      "apps/web/src/pages/Existing2.tsx": 534,
      "apps/web/src/pages/Gone2.tsx": 451,
    },
    existingFiles: [
      "apps/web/src/pages/Existing.tsx",
      "apps/web/src/pages/Existing2.tsx",
    ],
  },
  {
    name: "单个条目失效（单数报告文案）",
    entries: { "apps/web/src/pages/Gone.tsx": 500 },
    existingFiles: [],
  },
  {
    name: "全部条目失效 → 对象收敛为 {}",
    entries: {
      "apps/api/src/modules/gone/gone.service.ts": 600,
      "apps/web/src/pages/Gone.tsx": 500,
    },
    existingFiles: [],
  },
  {
    name: "空表 → 文件不变、无输出",
    entries: {},
    existingFiles: [],
  },
  {
    name: "无 scripts/arch-check.ts → 静默返回",
    archCheckText: null,
  },
  {
    name: "arch-check.ts 无 LONG_FILE_RATCHET 常量 → 静默返回",
    archCheckText: "const MAX_LINES = 450\nexport const unrelated = 1\n",
  },
  {
    name: "所有条目对应文件都存在 → 不剪枝、不落盘",
    entries: { "apps/web/src/pages/Existing.tsx": 1012 },
    existingFiles: ["apps/web/src/pages/Existing.tsx"],
  },
]

/** 构造与真实 arch-check.ts 相同形态的 LONG_FILE_RATCHET 字面量。 */
function buildArchCheckText(entries: Record<string, number>): string {
  const entryLines = Object.entries(entries).map(
    ([relativePath, baseline]) => `  "${relativePath}": ${baseline},`
  )
  const body =
    entryLines.length === 0
      ? "const LONG_FILE_RATCHET: Record<string, number> = {}\n"
      : `const LONG_FILE_RATCHET: Record<string, number> = {\n${entryLines.join("\n")}\n}\n`
  return `const MAX_LINES = 450\n\n${body}\nfunction countLines(): number {\n  return 0\n}\n`
}

/** 为 fixture 建一个独立临时 root（两份实现各用一份，互不影响）。 */
function createFixtureRoot(fixture: Fixture): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "long-file-ratchet-parity-"))

  for (const relativePath of fixture.existingFiles ?? []) {
    const absolute = path.join(root, relativePath)
    mkdirSync(path.dirname(absolute), { recursive: true })
    writeFileSync(absolute, "// fixture file\n")
  }

  if (fixture.archCheckText === null) return root

  mkdirSync(path.join(root, "scripts"), { recursive: true })
  writeFileSync(
    path.join(root, "scripts", "arch-check.ts"),
    fixture.archCheckText ?? buildArchCheckText(fixture.entries ?? {})
  )
  return root
}

interface RunResult {
  archCheck: string | null
  logs: string[]
}

/**
 * 执行剪枝并采集结果：arch-check.ts 最终字节 + 诊断输出。
 * 诊断走 stderr（`add:web --json` 的 stdout 只放结果），两个流都收以防将来换流。
 */
function runPrune(root: string): RunResult {
  const logs: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const capture = (...args: unknown[]) => {
    logs.push(args.map((argument) => String(argument)).join(" "))
  }
  console.log = capture as typeof console.log
  console.error = capture as typeof console.error
  try {
    pruneMissingLongFileRatchet(root)
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  const archCheckPath = path.join(root, "scripts", "arch-check.ts")
  return {
    archCheck: existsSync(archCheckPath)
      ? readFileSync(archCheckPath, "utf8")
      : null,
    logs,
  }
}

describe("pruneMissingLongFileRatchet（remove:module / remove:web / scaffold 共用）", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const root = createFixtureRoot(fixture)
      try {
        const archCheckPath = path.join(root, "scripts", "arch-check.ts")
        const before = existsSync(archCheckPath)
          ? readFileSync(archCheckPath, "utf8")
          : null
        const result = runPrune(root)

        // 没有文件 / 没有 LONG_FILE_RATCHET 常量：原样不动、无诊断
        if (fixture.archCheckText !== undefined) {
          expect(result.archCheck).toBe(before)
          expect(result.logs).toEqual([])
          return
        }

        const entries = fixture.entries ?? {}
        const kept = Object.fromEntries(
          Object.entries(entries).filter(([rel]) =>
            (fixture.existingFiles ?? []).includes(rel)
          )
        )
        expect(readLongFileRatchetEntries(root)).toEqual(kept)

        const pruned = Object.keys(entries).length - Object.keys(kept).length
        if (pruned === 0) {
          expect(result.archCheck).toBe(before)
          expect(result.logs).toEqual([])
          return
        }
        expect(result.logs).toHaveLength(1)
        expect(result.logs[0]).toContain(
          `Pruned ${pruned} stale LONG_FILE_RATCHET entr${pruned === 1 ? "y" : "ies"}`
        )
        if (Object.keys(kept).length === 0) {
          expect(result.archCheck).toContain("= {}")
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
})

/** 执行 upsert 并采集：返回条目数 + arch-check.ts 最终字节 + 日志。 */
function runUpsert(
  root: string,
  entries: Record<string, number>
): RunResult & { count: number } {
  let count: number | undefined
  const logs: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const capture = (...args: unknown[]) => {
    logs.push(args.map((argument) => String(argument)).join(" "))
  }
  console.log = capture as typeof console.log
  console.error = capture as typeof console.error
  try {
    count = upsertLongFileRatchetEntries(root, entries)
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  const archCheckPath = path.join(root, "scripts", "arch-check.ts")
  return {
    count: count ?? 0,
    archCheck: existsSync(archCheckPath)
      ? readFileSync(archCheckPath, "utf8")
      : null,
    logs,
  }
}

describe("upsertLongFileRatchetEntries（add:web 克隆默认端时补基线）", () => {
  /** 建一个只含 arch-check.ts 的临时 root，跑完即删。 */
  function withRoot(
    entries: Record<string, number>,
    fn: (root: string) => void
  ): void {
    const root = createFixtureRoot({ name: "upsert", entries })
    try {
      fn(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("新 key 按单行格式追加到对象闭合前", () => {
    withRoot({ "apps/web/src/pages/Big.tsx": 600 }, (root) => {
      const before = readFileSync(
        path.join(root, "scripts", "arch-check.ts"),
        "utf8"
      )
      const result = runUpsert(root, { "apps/portal/src/pages/Big.tsx": 600 })
      expect(result.count).toBe(1)
      expect(result.archCheck).toBe(
        before.replace(
          "\n}\n",
          '\n  "apps/portal/src/pages/Big.tsx": 600,\n}\n'
        )
      )
    })
  })

  it("已存在且值相同 → 不落盘、返回 0", () => {
    withRoot({ "apps/web/src/pages/Big.tsx": 600 }, (root) => {
      const before = readFileSync(
        path.join(root, "scripts", "arch-check.ts"),
        "utf8"
      )
      const result = runUpsert(root, { "apps/web/src/pages/Big.tsx": 600 })
      expect(result.count).toBe(0)
      expect(result.archCheck).toBe(before)
      expect(result.logs).toEqual([])
    })
  })

  it("已存在且新值更小 → 下调基线（棘轮只许减）", () => {
    withRoot({ "apps/web/src/pages/Big.tsx": 600 }, (root) => {
      const result = runUpsert(root, { "apps/web/src/pages/Big.tsx": 520 })
      expect(result.count).toBe(1)
      expect(result.archCheck).toContain('"apps/web/src/pages/Big.tsx": 520,')
      expect(result.archCheck).not.toContain(": 600,")
    })
  })

  it("已存在且新值更大 → 拒绝抬高基线", () => {
    withRoot({ "apps/web/src/pages/Big.tsx": 600 }, (root) => {
      const before = readFileSync(
        path.join(root, "scripts", "arch-check.ts"),
        "utf8"
      )
      const result = runUpsert(root, { "apps/web/src/pages/Big.tsx": 900 })
      expect(result.count).toBe(0)
      expect(result.archCheck).toBe(before)
    })
  })

  it("prune 折叠出的 {} 形态也能展开插入", () => {
    withRoot({}, (root) => {
      const result = runUpsert(root, { "apps/portal/src/pages/Big.tsx": 600 })
      expect(result.count).toBe(1)
      expect(result.archCheck).toContain(
        'const LONG_FILE_RATCHET: Record<string, number> = {\n  "apps/portal/src/pages/Big.tsx": 600,\n}'
      )
    })
  })

  it("混合：一个新 key + 一个下调，计数为 2", () => {
    withRoot({ "apps/web/src/pages/Big.tsx": 600 }, (root) => {
      const result = runUpsert(root, {
        "apps/web/src/pages/Big.tsx": 500,
        "apps/portal/src/pages/Big.tsx": 600,
      })
      expect(result.count).toBe(2)
      expect(result.archCheck).toContain('"apps/web/src/pages/Big.tsx": 500,')
      expect(result.archCheck).toContain(
        '"apps/portal/src/pages/Big.tsx": 600,'
      )
    })
  })

  it("无 scripts/arch-check.ts → 静默返回 0", () => {
    const root = createFixtureRoot({ name: "no-arch", archCheckText: null })
    try {
      const result = runUpsert(root, { "apps/portal/src/pages/Big.tsx": 600 })
      expect(result.count).toBe(0)
      expect(result.archCheck).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("upsert 后再 prune：文件都存在时不剪枝（两个方向幂等共存）", () => {
    withRoot({ "apps/web/src/pages/Big.tsx": 600 }, (root) => {
      const page = path.join(root, "apps/portal/src/pages/Big.tsx")
      mkdirSync(path.dirname(page), { recursive: true })
      writeFileSync(page, "// fixture\n")
      runUpsert(root, { "apps/portal/src/pages/Big.tsx": 600 })
      const afterUpsert = readFileSync(
        path.join(root, "scripts", "arch-check.ts"),
        "utf8"
      )
      // web 的条目在 fixture 里没有对应文件，prune 只应剪掉它、保留 portal 的
      pruneMissingLongFileRatchet(root)
      const afterPrune = readFileSync(
        path.join(root, "scripts", "arch-check.ts"),
        "utf8"
      )
      expect(afterPrune).toContain('"apps/portal/src/pages/Big.tsx": 600,')
      expect(afterPrune).not.toContain("apps/web/src/pages/Big.tsx")
      expect(afterUpsert).toContain("apps/web/src/pages/Big.tsx")
    })
  })
})
