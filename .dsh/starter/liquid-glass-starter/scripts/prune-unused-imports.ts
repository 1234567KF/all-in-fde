/**
 * 未使用 import 剪枝（`bun run imports:prune -- <files...>`）。
 *
 * 为什么需要：区块（region）机制要求 import 语句一律不打标记（否则会被
 * `eslint-plugin-simple-import-sort` 重排打散，多成员具名导入也无法按行归属）。
 * 因此删除区块 / 删除特性文件后，残留的未使用 import 交给本脚本统一清理，
 * 替代 gen:module 里「图标引用计数」「PERMISSIONS 值导入降级」一类状态机。
 *
 * 实现：TypeScript 语言服务的 `organizeImports` + `OrganizeImportsMode.RemoveUnused`
 * （TS 6.0 的 `organizeImports(args, formatOptions, preferences)` 形态）作为「哪些
 * import 应当存活」的 oracle，再在原文上只做**字节级删除**：
 *   - 只删未使用的 import / 具名成员；
 *   - **不重排**、不合并、不改顺序、不重格式化其余 import（排序仍由 eslint --fix 负责）；
 *     详见下方「精确删除」小节——TS 的 organizeImports 自身会重打印 import 声明组，
 *     remove:module 的逐字节往返验收要求这一层被消除；
 *   - 不碰副作用导入（`import "./side-effect"` / `import "./x.css"`）；
 *   - 整条 import 的成员全部未使用 → 删除整个语句（同一行多条 import 时只删本条，
 *     不吃掉同行其他语句）；
 *   - 具名 import 内部含注释时保守跳过并 console.warn（不自动改，避免误删注释）；
 *   - 没有未使用 import 的文件不落盘、内容逐字节不变。
 *
 * 依赖解析：根 node_modules 没有 typescript，脚本按候选路径 `require`
 * （`apps/api/node_modules/typescript` 等），找不到时给出清晰错误。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type ts from "typescript"

type TypeScriptApi = typeof ts

/** 仓库根（scripts/ 的上一级）；CLI 的相对路径按它解析。 */
export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))

/**
 * 候选 typescript 安装位置（相对仓库根）。
 * 根 node_modules 通常没有 typescript，它随 apps/* 的 devDependencies 安装；
 * `frontend/node_modules` 覆盖 flat 生成项目（只有 frontend/ + backend/，无 apps/）。
 */
const TYPESCRIPT_CANDIDATES = [
  "apps/api/node_modules/typescript",
  "apps/web/node_modules/typescript",
  "frontend/node_modules/typescript",
  "node_modules/typescript",
  "packages/shared/node_modules/typescript",
] as const

const requireFromHere = createRequire(import.meta.url)

/** 按候选路径同步 require typescript；全部缺失时抛出可读错误。 */
function loadTypeScriptSync(): TypeScriptApi {
  const tried: string[] = []
  for (const candidate of TYPESCRIPT_CANDIDATES) {
    const entry = path.join(REPO_ROOT, candidate, "lib", "typescript.js")
    tried.push(entry)
    if (!existsSync(entry)) continue

    const loaded = requireFromHere(entry) as {
      default?: TypeScriptApi
    } & TypeScriptApi
    const api = (loaded.default ?? loaded) as TypeScriptApi
    if (typeof api.createLanguageService !== "function") continue
    return api
  }

  throw new Error(
    `imports:prune 找不到 typescript。已尝试：\n${tried
      .map((file) => `  - ${file}`)
      .join("\n")}\n请在仓库根执行 bun install 后重试。`
  )
}

/**
 * 加载 typescript（异步外壳，供调用方/测试使用）。
 *
 * 内部走同步 `require` 而不是顶层 `await import()`：顶层 await 会让本模块在 Bun
 * `--isolate` / `--parallel` 下触发 "Cannot access 'tsApi' before initialization"
 * 的 TDZ 错误（把测试并发化时踩到）。
 */
export async function loadTypeScript(): Promise<TypeScriptApi> {
  return loadTypeScriptSync()
}

const tsApi: TypeScriptApi = loadTypeScriptSync()

/** TS 6.0 起 `organizeImports` 改为接收 `OrganizeImportsArgs`（含 mode）。 */
function assertSupportedTypeScript(): void {
  const major = Number.parseInt(
    tsApi.versionMajorMinor.split(".")[0] ?? "0",
    10
  )
  if (major < 6) {
    throw new Error(
      `imports:prune 依赖 TypeScript >= 6.0 的 organizeImports(args) API，当前为 ${tsApi.version}`
    )
  }
}

assertSupportedTypeScript()

/**
 * TS 内部把路径归一成正斜杠（Windows 上还按大小写不敏感比较）；宿主查表前必须
 * 做同样归一，否则 Windows 下内存快照会全部 miss、退化成读磁盘旧内容。
 */
function canonicalFileName(fileName: string): string {
  const posix = fileName.replaceAll("\\", "/")
  return tsApi.sys.useCaseSensitiveFileNames ? posix : posix.toLowerCase()
}

/** 共享 documentRegistry：同一进程处理多个文件时复用 lib 解析缓存。 */
let documentRegistry: ts.DocumentRegistry | null = null

function getDocumentRegistry(): ts.DocumentRegistry {
  documentRegistry ??= tsApi.createDocumentRegistry()
  return documentRegistry
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: tsApi.ScriptTarget.ES2022,
  module: tsApi.ModuleKind.ESNext,
  moduleResolution: tsApi.ModuleResolutionKind.Bundler,
  jsx: tsApi.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
  noEmit: true,
}

/**
 * 语言服务宿主：内存文件优先，其余（lib、依赖模块）走磁盘。
 *
 * contents / versions 是会话持有的可变引用：会话内重复剪枝时只递增变化文件的版本，
 * TS 会以旧 Program 为增量基础，避免每轮重新解析依赖模块（实测 8 文件首轮 ~500ms、
 * 后续增量 ~70ms）。
 */
function createLanguageServiceHost(
  contents: ReadonlyMap<string, string>,
  versions: ReadonlyMap<string, number>
): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => COMPILER_OPTIONS,
    getScriptFileNames: () => [...contents.keys()],
    getScriptVersion: (fileName) =>
      String(versions.get(canonicalFileName(fileName)) ?? 0),
    getScriptSnapshot: (fileName) => {
      const content =
        contents.get(canonicalFileName(fileName)) ??
        tsApi.sys.readFile(fileName)
      return content === undefined
        ? undefined
        : tsApi.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (options) => tsApi.getDefaultLibFilePath(options),
    fileExists: tsApi.sys.fileExists,
    readFile: tsApi.sys.readFile,
    readDirectory: tsApi.sys.readDirectory,
    directoryExists: tsApi.sys.directoryExists,
    getDirectories: tsApi.sys.getDirectories,
    useCaseSensitiveFileNames: () => tsApi.sys.useCaseSensitiveFileNames,
    getNewLine: () => tsApi.sys.newLine,
  }
}

/** 把语言服务返回的 textChanges（从后往前）应用到源码上。 */
function applyFileTextChanges(
  source: string,
  fileName: string,
  changes: readonly ts.FileTextChanges[]
): string {
  const resolvedFileName = canonicalFileName(path.resolve(fileName))
  const textChanges = changes
    .filter(
      (change) =>
        canonicalFileName(path.resolve(change.fileName)) === resolvedFileName
    )
    .flatMap((change) => change.textChanges)
    .sort((left, right) => right.span.start - left.span.start)

  let result = source
  for (const change of textChanges) {
    result =
      result.slice(0, change.span.start) +
      change.newText +
      result.slice(change.span.start + change.span.length)
  }
  return result
}

// ─── 精确删除：只删未使用 import 的字节，其余格式原样保留 ─────────────────────
//
// 背景：TS 6 的 `organizeImports` 在 RemoveUnused 模式下也会用 formatter 重新打印
// 受影响的 import 声明组（`updateImportDeclarationAndClause` 总是产生新节点），
// 带来「逗号后空格丢失」「多行具名 import 被压成单行」等纯格式化副作用。
// `remove:module` 的「生成 → 剥离 → imports:prune 逐字节还原」验收要求 pruner
// 只删字节、不改格式，因此这里把 organizeImports 的输出当作「哪些 import 应当
// 存活」的 oracle，解析原文与 oracle 的 import 声明做匹配，只在原文上生成删除编辑：
//   - 整条 import 全未使用 → 删除整条语句（含行尾换行）；
//   - 具名成员未使用 → 删除该成员及相邻逗号，其余换行/空格/顺序原样；
//   - default / namespace import 被删 → 只删对应片段与逗号。
// 含注释的具名 import 不做成员级删除（避免误删注释）：跳过该条并 console.warn，
// 其余 import 照常精确删除；只有 oracle 结构无法映射时才回退 TS organized 输出。

interface TextEdit {
  start: number
  length: number
  newText: string
}

/** 按扩展名选择与语言服务一致的 ScriptKind（决定 TSX/TS 解析模式）。 */
function parseSourceFile(fileName: string, content: string): ts.SourceFile {
  const scriptKind = fileName.endsWith(".tsx")
    ? tsApi.ScriptKind.TSX
    : fileName.endsWith(".jsx")
      ? tsApi.ScriptKind.JSX
      : fileName.endsWith(".js")
        ? tsApi.ScriptKind.JS
        : tsApi.ScriptKind.TS
  return tsApi.createSourceFile(
    fileName,
    content,
    tsApi.ScriptTarget.ES2022,
    /*setParentNodes*/ true,
    scriptKind
  )
}

/** import 内部的注释会让「按片段删除」误伤注释，直接回退到 TS changes。 */
function hasCommentTrivia(text: string): boolean {
  return text.includes("//") || text.includes("/*")
}

/** oracle 声明是否是原文声明的「绑定子集」：模块相同、绑定按顺序保留。 */
function isBindingSuperset(
  original: ts.ImportDeclaration,
  pruned: ts.ImportDeclaration
): boolean {
  if (original.moduleSpecifier.getText() !== pruned.moduleSpecifier.getText())
    return false

  const originalClause = original.importClause
  const prunedClause = pruned.importClause
  if (!prunedClause) return !originalClause
  if (!originalClause) return false
  if (originalClause.isTypeOnly !== prunedClause.isTypeOnly) return false
  if (prunedClause.name && prunedClause.name.text !== originalClause.name?.text)
    return false

  const prunedBindings = prunedClause.namedBindings
  if (!prunedBindings) return true
  const originalBindings = originalClause.namedBindings
  if (!originalBindings) return false

  if (tsApi.isNamespaceImport(prunedBindings)) {
    return (
      tsApi.isNamespaceImport(originalBindings) &&
      originalBindings.name.text === prunedBindings.name.text
    )
  }

  if (!tsApi.isNamedImports(originalBindings)) return false
  const originalNames = originalBindings.elements.map(
    (element) => element.name.text
  )
  let searchFrom = 0
  for (const element of prunedBindings.elements) {
    while (
      searchFrom < originalNames.length &&
      originalNames[searchFrom] !== element.name.text
    ) {
      searchFrom += 1
    }
    if (searchFrom >= originalNames.length) return false
    searchFrom += 1
  }
  return true
}

/** 整条 import 语句删除：从行首到语句结束，并吞掉行尾换行。 */
interface LineBounds {
  /** 行内容起点（行首 EOL 之后）。 */
  lineStart: number
  /** 行内容终点（不含行尾 EOL；CRLF 的 `\r` 也算 EOL）。 */
  contentEnd: number
  /** 下一行起点（含行尾 EOL；文件末行为 source.length）。 */
  nextLineStart: number
}

/** 取 position 所在行的边界（支持 CRLF；position 可等于源码末尾）。 */
function getLineBounds(source: string, position: number): LineBounds {
  const lineStart = source.lastIndexOf("\n", position - 1) + 1
  const nextNewline = source.indexOf("\n", position)
  if (nextNewline === -1) {
    return {
      lineStart,
      contentEnd: source.length,
      nextLineStart: source.length,
    }
  }
  const contentEnd =
    nextNewline > lineStart && source[nextNewline - 1] === "\r"
      ? nextNewline - 1
      : nextNewline
  return { lineStart, contentEnd, nextLineStart: nextNewline + 1 }
}

/** 1-based 行号（仅用于告警定位，热点路径不调用）。 */
function lineNumberAt(source: string, position: number): number {
  let line = 1
  for (let index = 0; index < position; index += 1) {
    if (source[index] === "\n") line += 1
  }
  return line
}

/**
 * 整条 import 语句删除编辑。
 *
 * 不能假设「一行一条 import」：`import { a } from "./a"; import { b } from "./b"` 很常见。
 * 因此按行前后缀判断：
 *   - 整行只有本条语句 → 删除整行（含行尾 EOL，这是 gen:module 往返的常规路径）；
 *   - 同行还有前/后语句 → 只删本条语句与相邻分隔空白，绝不吞掉同行其他 import。
 * 删除后不额外规范化空行（与 TS RemoveUnused 语义一致）。
 */
function pushWholeImportRemoval(
  edits: TextEdit[],
  source: string,
  declaration: ts.ImportDeclaration
): void {
  const start = declaration.getStart()
  const firstLine = getLineBounds(source, start)
  const lastLine = getLineBounds(source, declaration.end)

  const prefix = source.slice(firstLine.lineStart, start)
  const suffix = source.slice(declaration.end, lastLine.contentEnd)
  const prefixBlank = prefix.trim() === ""
  const suffixBlank = suffix.trim() === ""

  // 常规：整行只有这一条语句 → 删除整行（含 EOL）
  if (prefixBlank && suffixBlank) {
    edits.push({
      start: firstLine.lineStart,
      length: lastLine.nextLineStart - firstLine.lineStart,
      newText: "",
    })
    return
  }

  let deleteStart = start
  let deleteEnd = declaration.end
  // 防御：分号通常已包含在 statement.end 内，若未包含则一并删除
  if (source[deleteEnd] === ";") deleteEnd += 1

  if (suffixBlank) {
    // 本条位于行尾：连同前面的分隔空白一起删，保留行尾换行
    deleteStart = firstLine.lineStart + prefix.trimEnd().length
    deleteEnd = lastLine.contentEnd
  } else {
    // 本条后面还有别的语句：吃掉语句后的紧邻空格（不跨行）
    if (prefixBlank) deleteStart = firstLine.lineStart
    while (source[deleteEnd] === " " || source[deleteEnd] === "\t")
      deleteEnd += 1
  }

  edits.push({
    start: deleteStart,
    length: deleteEnd - deleteStart,
    newText: "",
  })
}

/**
 * 给一对「原文声明 → oracle 声明」生成成员级删除编辑；无法安全处理时返回 false。
 *
 * 具名 import 内部含注释时不做成员级删除（保守跳过 + 告警），返回 true 且不产生编辑。
 */
function collectImportRemovalEdits(
  source: string,
  fileName: string,
  original: ts.ImportDeclaration,
  pruned: ts.ImportDeclaration,
  edits: TextEdit[]
): boolean {
  const originalClause = original.importClause
  const prunedClause = pruned.importClause
  // 副作用导入（无 importClause）两边一致，无需编辑
  if (!originalClause || !prunedClause) return true

  const defaultRemoved =
    originalClause.name !== undefined && prunedClause.name === undefined
  const originalBindings = originalClause.namedBindings
  const prunedBindings = prunedClause.namedBindings

  if (!prunedBindings) {
    // 具名 / 命名空间绑定全部删除，只保留 default import
    if (!originalBindings) return true
    const name = originalClause.name
    if (!name) return false
    edits.push({
      start: name.end,
      length: originalBindings.end - name.end,
      newText: "",
    })
    return true
  }

  if (!originalBindings) return false

  if (tsApi.isNamespaceImport(prunedBindings)) {
    if (!tsApi.isNamespaceImport(originalBindings)) return false
    if (defaultRemoved) {
      const name = originalClause.name
      if (!name) return false
      edits.push({
        start: name.getStart(),
        length: originalBindings.getStart() - name.getStart(),
        newText: "",
      })
    }
    return true
  }

  if (!tsApi.isNamedImports(originalBindings)) return false

  const keptNames = new Set(
    prunedBindings.elements.map((element) => element.name.text)
  )
  const elements = originalBindings.elements
  const kept = elements.map((element) => keptNames.has(element.name.text))

  // 有成员需要删除且 import 内部含注释 → 保守跳过（不自动删），避免误删注释/注释错位
  const hasRemoval = kept.some((isKept) => !isKept) || defaultRemoved
  if (hasRemoval) {
    const bindingsText = source.slice(
      originalBindings.getStart(),
      originalBindings.end
    )
    if (hasCommentTrivia(bindingsText)) {
      console.warn(
        `[imports:prune] 跳过含注释的 import（存在未使用成员但不自动删除，请人工处理）：${fileName}:${lineNumberAt(source, original.getStart())}`
      )
      return true
    }
  }

  // 连续未使用成员按「段」删除：优先借用前一个保留成员的结尾（吃掉前导逗号），
  // 开头段则删到下一个保留成员的起点（吃掉后置逗号），从而保留原有换行/缩进。
  let index = 0
  while (index < elements.length) {
    if (kept[index]) {
      index += 1
      continue
    }
    let lastRemoved = index
    while (lastRemoved + 1 < elements.length && !kept[lastRemoved + 1])
      lastRemoved += 1

    const previousKept = index > 0 ? elements[index - 1] : undefined
    const nextKept =
      lastRemoved + 1 < elements.length ? elements[lastRemoved + 1] : undefined
    if (previousKept) {
      edits.push({
        start: previousKept.end,
        length: elements[lastRemoved].end - previousKept.end,
        newText: "",
      })
    } else if (nextKept) {
      edits.push({
        start: elements[index].getStart(),
        length: nextKept.getStart() - elements[index].getStart(),
        newText: "",
      })
    } else {
      return false
    }
    index = lastRemoved + 1
  }

  if (defaultRemoved) {
    const name = originalClause.name
    if (!name) return false
    edits.push({
      start: name.getStart(),
      length: originalBindings.getStart() - name.getStart(),
      newText: "",
    })
  }
  return true
}

/** 从后往前应用删除编辑（重叠编辑按先到者优先丢弃，防御性兜底）。 */
function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((left, right) => right.start - left.start)
  let result = source
  let previousStart = Number.POSITIVE_INFINITY
  for (const edit of sorted) {
    if (edit.start + edit.length > previousStart) continue
    result =
      result.slice(0, edit.start) +
      edit.newText +
      result.slice(edit.start + edit.length)
    previousStart = edit.start
  }
  return result
}

/**
 * 把 TS organizeImports 的输出转换为「只删除未使用 import」的精确编辑。
 *
 * @returns 精确编辑后的源码；无法安全匹配时返回 null（调用方回退到 oracle 输出）
 */
function pruneImportsPreservingFormat(
  original: string,
  organized: string,
  fileName: string
): string | null {
  if (organized === original) return original

  const originalFile = parseSourceFile(fileName, original)
  const organizedFile = parseSourceFile(fileName, organized)
  const originalImports = originalFile.statements.filter(
    tsApi.isImportDeclaration
  )
  const organizedImports = organizedFile.statements.filter(
    tsApi.isImportDeclaration
  )
  if (organizedImports.length > originalImports.length) return null

  const edits: TextEdit[] = []
  let cursor = 0
  for (const organizedImport of organizedImports) {
    let match = -1
    for (let index = cursor; index < originalImports.length; index += 1) {
      if (isBindingSuperset(originalImports[index], organizedImport)) {
        match = index
        break
      }
    }
    if (match < 0) return null

    for (let index = cursor; index < match; index += 1) {
      pushWholeImportRemoval(edits, original, originalImports[index])
    }
    if (
      !collectImportRemovalEdits(
        original,
        fileName,
        originalImports[match],
        organizedImport,
        edits
      )
    ) {
      return null
    }
    cursor = match + 1
  }
  for (let index = cursor; index < originalImports.length; index += 1) {
    pushWholeImportRemoval(edits, original, originalImports[index])
  }

  return applyTextEdits(original, edits)
}

/** TS changes → 精确删除（失败时回退到 TS 的 organized 输出，保证至少完成剪枝）。 */
function pruneFromOrganized(
  original: string,
  organized: string,
  absolute: string
): string {
  if (organized === original) return original
  return (
    pruneImportsPreservingFormat(original, organized, absolute) ?? organized
  )
}

/** 可复用的剪枝会话：同一批路径反复剪枝时复用语言服务 / Program。 */
export interface UnusedImportsSession {
  /**
   * 剪枝一批文件（可在同一会话内重复调用；仅内容变化的文件会参与增量更新）。
   * 会话只增不减：先前传入而未出现在本次入参中的文件仍留在 Program 里，作为依赖存在。
   */
  organize(files: ReadonlyMap<string, string>): Map<string, string>
  /** 释放语言服务；释放后继续调用 organize 会抛错 */
  dispose(): void
}

/**
 * 创建可复用剪枝会话。
 *
 * 语言服务 / Program 的创建是主要开销（单文件调用约 100ms+，其中 organize 本身只占
 * 小部分），重复建模的代价在「一遍遍剥区块再剪枝」的往返场景里会成倍放大：同一会话
 * 内后续轮次只重新解析发生变化的文件（实测 8 文件 6 轮：逐轮新建 ~2.0s → 会话复用
 * ~0.85s）。一次性场景直接用 organizeUnusedImportsBatch 即可。
 */
export function createUnusedImportsSession(): UnusedImportsSession {
  const contents = new Map<string, string>()
  const versions = new Map<string, number>()
  let service: ts.LanguageService | null = null
  let disposed = false

  return {
    organize(files) {
      if (disposed) {
        throw new Error("imports:prune 会话已释放，无法继续剪枝")
      }
      const absoluteFiles = new Map<string, string>()
      for (const [fileName, content] of files) {
        absoluteFiles.set(path.resolve(fileName), content)
      }
      const result = new Map<string, string>()
      if (absoluteFiles.size === 0) return result

      for (const [absolute, content] of absoluteFiles) {
        const key = canonicalFileName(absolute)
        if (contents.get(key) === content) continue
        contents.set(key, content)
        versions.set(key, (versions.get(key) ?? 0) + 1)
      }

      service ??= tsApi.createLanguageService(
        createLanguageServiceHost(contents, versions),
        getDocumentRegistry()
      )
      for (const [absolute, original] of absoluteFiles) {
        const changes = service.organizeImports(
          {
            type: "file",
            fileName: absolute,
            mode: tsApi.OrganizeImportsMode.RemoveUnused,
          },
          {},
          undefined
        )
        const organized = applyFileTextChanges(original, absolute, changes)
        result.set(absolute, pruneFromOrganized(original, organized, absolute))
      }
      return result
    },

    dispose() {
      disposed = true
      service?.dispose()
      service = null
    },
  }
}

/**
 * 纯函数：批量删除未使用 import（一次性，共用一个 LanguageService 与 TS Program）。
 *
 * 需要**多轮**剪枝时用 createUnusedImportsSession（复用 Program 增量更新）；
 * 本函数等价于「建会话 → 剪一批 → 释放」，适合 CLI 与单次批量场景。
 *
 * @param files 绝对路径 → 源码（绝对路径决定解析模式；文件无需存在于磁盘）
 * @returns 绝对路径 → 剪枝后源码（与入参同 key 集合）
 */
export function organizeUnusedImportsBatch(
  files: ReadonlyMap<string, string>
): Map<string, string> {
  const session = createUnusedImportsSession()
  try {
    return session.organize(files)
  } finally {
    session.dispose()
  }
}

/**
 * 纯函数：删除指定源码里未使用的 import / 具名成员。
 *
 * 只做删除：不重排、不合并、不重格式化其余 import，不碰副作用导入；若 TS oracle 的
 * 输出无法安全映射回原文（如 import 内部含注释），回退到 TS organized 输出（仍完成
 * 剪枝，但可能有格式化副作用）。
 *
 * @param fileName 文件绝对路径（决定 TSX/TS 解析模式与模块解析上下文；无需已存在于磁盘）
 * @param content  文件内容
 */
export function organizeUnusedImports(
  fileName: string,
  content: string
): string {
  const absolute = path.resolve(fileName)
  return (
    organizeUnusedImportsBatch(new Map([[absolute, content]])).get(absolute) ??
    content
  )
}

/**
 * 批量删除未使用 import 并落盘。
 *
 * @param root     仓库根
 * @param relPaths 相对 root 的路径（也接受绝对路径）；非 `.ts/.tsx`、不存在、无改动均跳过
 * @returns 实际发生改动的文件（保持传入时的路径形态，便于调用方直接打印 / 继续交给 prettier）
 */
export function pruneUnusedImportsInFiles(
  root: string,
  relPaths: readonly string[]
): string[] {
  const candidates = relPaths
    .map((input) => ({
      input,
      absolute: path.isAbsolute(input) ? input : path.resolve(root, input),
    }))
    .filter(({ absolute }) => /\.(ts|tsx)$/.test(absolute))

  const files = new Map<string, string>()
  for (const { absolute } of candidates) {
    if (files.has(absolute)) continue
    try {
      files.set(absolute, readFileSync(absolute, "utf8"))
    } catch {
      // 缺失文件（已被删除 / 清单漂移）按幂等语义跳过
    }
  }
  if (files.size === 0) return []

  const organized = organizeUnusedImportsBatch(files)
  const changed: string[] = []
  const seen = new Set<string>()
  for (const { input, absolute } of candidates) {
    if (seen.has(absolute)) continue
    seen.add(absolute)
    const original = files.get(absolute)
    const next = organized.get(absolute)
    if (original === undefined || next === undefined || next === original) {
      continue
    }
    writeFileSync(absolute, next)
    changed.push(input)
  }
  return changed
}

const USAGE = `用法：bun run imports:prune -- <file1> <file2> ...

删除源码中未使用的 import / 具名成员（TypeScript OrganizeImportsMode.RemoveUnused）：
  - 只处理 .ts / .tsx；相对路径按仓库根解析，也接受绝对路径；
  - 不重排、不合并、不重格式化其余 import；副作用导入（import "./x.css"）不删；
  - 没有未使用 import 的文件不落盘（内容逐字节不变）。`

function main(argv: readonly string[]): void {
  const files = argv.filter((arg) => arg !== "--")
  if (files.length === 0) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const changed = pruneUnusedImportsInFiles(REPO_ROOT, files)
  if (changed.length === 0) {
    console.log(`imports:prune: ${files.length} 个文件均无需清理`)
    return
  }
  console.log(`imports:prune: 清理了 ${changed.length} 个文件中的未使用 import`)
  for (const file of changed) console.log(`   ✓ ${file}`)
}

if (import.meta.main) {
  main(process.argv.slice(2))
}
