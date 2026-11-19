/**
 * imports:prune 单测。
 *
 * 覆盖设计书 §7.2 要求的行为：只删未用成员、不重排、保留副作用导入、
 * 整条 import 清空时删除语句、无未用不改动；以及批量落盘语义
 * （只写实际改动文件、缺失/非 TS 文件跳过、幂等）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it, spyOn } from "bun:test"

import {
  createUnusedImportsSession,
  loadTypeScript,
  organizeUnusedImports,
  organizeUnusedImportsBatch,
  pruneUnusedImportsInFiles,
} from "./prune-unused-imports"

const TEMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "imports-prune-test-"))

afterAll(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true })
})

let fileSeq = 0
function writeTempFile(relativePath: string, content: string): string {
  const absolute = path.join(TEMP_ROOT, relativePath)
  writeFileSync(absolute, content)
  return absolute
}

function uniqueName(extension: "ts" | "tsx" = "ts"): string {
  fileSeq += 1
  return `fixture-${fileSeq}.${extension}`
}

describe("organizeUnusedImports：只删未使用 import", () => {
  it("只删未使用的具名成员，已使用成员与顺序不变", () => {
    const source = `import { useState } from "react"
import { unusedB } from "./b"
import { usedC, unusedC } from "./c"

export function f() {
  useState()
  usedC()
  return 1
}
`
    const result = organizeUnusedImports(
      writeTempFile(uniqueName(), source),
      source
    )
    expect(result).toBe(`import { useState } from "react"
import { usedC } from "./c"

export function f() {
  useState()
  usedC()
  return 1
}
`)
  })

  it("无未使用 import 时不产生任何格式化副作用（TS formatter 回归）", () => {
    const source = `import {
  usedA,
  usedB,
} from "./multi"
import { c,d } from "./tight"

export const value = [usedA, usedB, c, d]
`
    // TS organizeImports 会重打印 import 声明组（逗号空格、多行折叠），pruner 必须只做删除、
    // 其余字节原样返回——这是 remove:module「生成 → 剥离 → imports:prune 逐字节还原」的前提。
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(source)
  })

  it("多行具名 import 删除未使用成员后保持多行与原有缩进", () => {
    const source = `import {
  usedA,
  unusedB,
  usedC,
} from "./mod"

export const value = [usedA, usedC]
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(
      `import {
  usedA,
  usedC,
} from "./mod"

export const value = [usedA, usedC]
`
    )
  })

  it("删除 gen:module 插入的整条 import 后逐字节还原原文件", () => {
    const original = `import { unmodified } from "./a"

export const x = unmodified
`
    const generated = `import { unmodified } from "./a"
import { generatedRoute } from "./generated-route"

export const x = unmodified
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), generated), generated)
    ).toBe(original)
  })

  it("default import 未使用、具名成员保留 → 只删 default 片段", () => {
    const source = `import Foo, { bar } from "./x"

export const value = bar
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(
      `import { bar } from "./x"

export const value = bar
`
    )
  })

  it("namespace import 未使用、default 保留 → 只删 namespace 片段", () => {
    const source = `import Foo, * as Ns from "./x"

export const value = Foo
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(
      `import Foo from "./x"

export const value = Foo
`
    )
  })

  it("不重排、不合并 import 语句", () => {
    const source = `import { b } from "./b"
import { a } from "./a"

export const x = [b, a]
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(source)
  })

  it("保留副作用导入（样式 / 模块初始化）", () => {
    const source = `import "./side-effect"
import "./styles.css"
import { unused } from "./x"

export const a = 1
`
    const result = organizeUnusedImports(
      writeTempFile(uniqueName(), source),
      source
    )
    expect(result).toBe(`import "./side-effect"
import "./styles.css"

export const a = 1
`)
  })

  it("整条 import 的成员全部未使用 → 删除整条语句", () => {
    const source = `import { unused1, unused2 } from "./x"
import fs from "node:fs"
export const a = 1
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe("export const a = 1\n")
  })

  it("整段 import 删除后保留其后的空行（剩余格式化交给 eslint --fix / prettier）", () => {
    const source = `import { unused } from "./x"

export const a = 1
`
    // TS RemoveUnused 只删除 import 语句本身，不负责收敛空行；后续 eslint --fix 会处理
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe("\nexport const a = 1\n")
  })

  it("没有未使用 import → 原样返回（含末尾换行）", () => {
    const source = `import { readFileSync } from "node:fs"
import { join } from "node:path"

export const read = (file: string) => readFileSync(join(file, "x"))
`
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(source)
  })

  it("没有 import 的文件原样返回", () => {
    const source = "export const a = 1\n"
    expect(
      organizeUnusedImports(writeTempFile(uniqueName(), source), source)
    ).toBe(source)
  })

  it("TSX：删除未使用 import，JSX 与已使用 import 不动", () => {
    const source = `import { useState } from "react"
import { unused } from "./x"
import "./styles.css"

export function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
`
    const result = organizeUnusedImports(
      writeTempFile(uniqueName("tsx"), source),
      source
    )
    expect(result).toContain('import { useState } from "react"')
    expect(result).toContain('import "./styles.css"')
    expect(result).not.toContain('import { unused } from "./x"')
    expect(result).toContain(
      "<button onClick={() => setCount(count + 1)}>{count}</button>"
    )
  })
})

describe("同一行多条 import（R1-A1：不误删同行其他 import）", () => {
  /** 断言输出可被 TypeScript 解析（无 parse diagnostics）。 */
  async function assertParses(content: string): Promise<void> {
    const tsApi = await loadTypeScript()
    const sourceFile = tsApi.createSourceFile(
      "same-line.ts",
      content,
      tsApi.ScriptTarget.ES2022,
      true,
      tsApi.ScriptKind.TS
    )
    const diagnostics =
      (sourceFile as unknown as { parseDiagnostics?: readonly unknown[] })
        .parseDiagnostics ?? []
    expect(diagnostics).toEqual([])
  }

  it("同一行 a 用 / b 不用 → 保留 a，输出可被 TS 解析", async () => {
    const source = `import { a } from "./a"; import { b } from "./b"
export const v = a
`
    const result = organizeUnusedImports(
      writeTempFile(uniqueName(), source),
      source
    )
    expect(result).toBe(`import { a } from "./a";
export const v = a
`)
    expect(result).toContain('"./a"')
    expect(result).not.toContain('"./b"')
    await assertParses(result)
  })

  it("同一行 a 不用 / b 用 → 只删 a，保留 b", async () => {
    const source = `import { a } from "./a"; import { b } from "./b"
export const v = b
`
    const result = organizeUnusedImports(
      writeTempFile(uniqueName(), source),
      source
    )
    expect(result).toBe(`import { b } from "./b"
export const v = b
`)
    expect(result).not.toContain('"./a"')
    await assertParses(result)
  })

  it("同一行三条、中间不用 → 首尾保留且顺序不变", async () => {
    const source = `import { a } from "./a"; import { b } from "./b"; import { c } from "./c"
export const v = a + c
`
    const result = organizeUnusedImports(
      writeTempFile(uniqueName(), source),
      source
    )
    expect(result).toBe(`import { a } from "./a"; import { c } from "./c"
export const v = a + c
`)
    expect(result).not.toContain('"./b"')
    await assertParses(result)
  })
})

describe("含注释的具名 import（R1-A2：保守跳过 + 告警，不重排原文）", () => {
  it("存在未使用成员且 import 内含注释 → 原样保留并 console.warn", () => {
    const source = `import {
  used,
  // 保留这个注释
  unused,
} from "./x"

export const v = used
`
    const fileName = writeTempFile(uniqueName(), source)
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const result = organizeUnusedImports(fileName, source)
      expect(result).toBe(source)
      const messages = warn.mock.calls.map((call) =>
        call.map((argument) => String(argument)).join(" ")
      )
      expect(
        messages.some((message) => message.includes("跳过含注释的 import"))
      ).toBe(true)
      expect(messages.some((message) => message.includes(fileName))).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it("import 内含注释但没有未使用成员 → 不改动、不告警", () => {
    const source = `import {
  usedA,
  // 这条注释必须保留
  usedB,
} from "./x"

export const v = [usedA, usedB]
`
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(
        organizeUnusedImports(writeTempFile(uniqueName(), source), source)
      ).toBe(source)
      expect(warn.mock.calls).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })
})

describe("pruneUnusedImportsInFiles：批量落盘", () => {
  it("只写实际改动的文件，并返回传入形态的路径", () => {
    const changedName = uniqueName()
    const untouchedName = uniqueName()
    writeTempFile(
      changedName,
      'import { unused } from "./x"\nexport const a = 1\n'
    )
    const untouchedSource =
      'import { join } from "node:path"\n\nexport const p = join("a", "b")\n'
    writeTempFile(untouchedName, untouchedSource)

    const changed = pruneUnusedImportsInFiles(TEMP_ROOT, [
      changedName,
      untouchedName,
      "missing.ts",
      "data.json",
    ])

    expect(changed).toEqual([changedName])
    expect(readFileSync(path.join(TEMP_ROOT, changedName), "utf8")).toBe(
      "export const a = 1\n"
    )
    expect(readFileSync(path.join(TEMP_ROOT, untouchedName), "utf8")).toBe(
      untouchedSource
    )
  })

  it("绝对路径入参原样返回，且同一文件重复列出只处理一次", () => {
    const name = uniqueName()
    const absolute = writeTempFile(
      name,
      'import { unused } from "./x"\nexport const a = 1\n'
    )

    const changed = pruneUnusedImportsInFiles(TEMP_ROOT, [absolute, absolute])

    expect(changed).toEqual([absolute])
    expect(readFileSync(absolute, "utf8")).toBe("export const a = 1\n")
  })

  it("幂等：再次执行无改动返回空数组", () => {
    const name = uniqueName()
    writeTempFile(name, 'import { unused } from "./x"\nexport const a = 1\n')
    pruneUnusedImportsInFiles(TEMP_ROOT, [name])

    expect(pruneUnusedImportsInFiles(TEMP_ROOT, [name])).toEqual([])
  })

  it("空列表 / 全部不可处理文件 → 返回空数组", () => {
    expect(pruneUnusedImportsInFiles(TEMP_ROOT, [])).toEqual([])
    expect(
      pruneUnusedImportsInFiles(TEMP_ROOT, ["missing.ts", "readme.md"])
    ).toEqual([])
  })
})

describe("createUnusedImportsSession：多轮复用语言服务", () => {
  it("连续两轮（内容变化）结果与一次性批量剪枝一致", () => {
    const session = createUnusedImportsSession()
    try {
      const first = new Map([
        [
          path.join(TEMP_ROOT, "session-a.ts"),
          'import { unusedA } from "./a"\nexport const a = 1\n',
        ],
      ])
      const firstResult = session.organize(first)
      expect([...firstResult]).toEqual([
        [path.join(TEMP_ROOT, "session-a.ts"), "export const a = 1\n"],
      ])
      expect([...organizeUnusedImportsBatch(first)]).toEqual([...firstResult])

      // 同一路径换了内容：会话必须重新解析（版本号递增），结果与一次性批量一致
      const second = new Map([
        [
          path.join(TEMP_ROOT, "session-a.ts"),
          'import { unusedB } from "./b"\nexport const b = 2\n',
        ],
      ])
      const secondResult = session.organize(second)
      expect([...secondResult]).toEqual([
        [path.join(TEMP_ROOT, "session-a.ts"), "export const b = 2\n"],
      ])
      expect([...organizeUnusedImportsBatch(second)]).toEqual([...secondResult])
    } finally {
      session.dispose()
    }
  })

  it("dispose 后拒绝继续调用", () => {
    const session = createUnusedImportsSession()
    session.dispose()
    expect(() => session.organize(new Map())).toThrow(/会话已释放/)
  })
})
