#!/usr/bin/env bun
/**
 * 按 `web-apps.json` 逐端执行前端任务——新增端不需要改根 package.json。
 *
 * 用法：bun run scripts/run-web-task.ts <task>
 *
 * dev 用 concurrently 同时拉起 api 与所有端（保留原有的带前缀彩色输出）；
 * 其余任务串行执行、遇错即停，输出直接继承 stdio。
 *
 * vitest 必须走 `bunx vitest run` 而不是包脚本：包脚本里的 `vitest` 会经
 * node_modules/.bin 的 node shebang 落到 Node 上，而 CI 的 bun:1-alpine 没有 node。
 * 同时必须显式给出 NODE_ENV=test：`bun scripts/x.ts` 直接执行时 Bun 会隐式设
 * NODE_ENV=production，子进程继承后 react-dom 走 production 分支（没有 act），
 * 所有 render/renderHook 用例都会报 `React.act is not a function`。
 */
import path from "node:path"
import { fileURLToPath } from "node:url"

import { readWebApps, type WebApp } from "./lib/web-apps.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

/** 走包脚本的任务（各端 package.json 必须有同名 script） */
const SCRIPT_TASKS = {
  dev: "dev",
  build: "build",
  typecheck: "typecheck",
  lint: "lint",
  "lint:nocache": "lint:nocache",
  "lint:fix": "lint:fix",
} as const

/**
 * 直接指定 argv 的任务：在端目录内执行，不经包脚本。
 *
 * 一律用 process.execPath 而不是裸 "bun" / "bunx"：无 shell 的 spawn 在 Windows
 * 只命中 .exe，经 npm/scoop/choco 安装只有 .cmd/.ps1 shim 时会 ENOENT。
 * `bun x` 等价 `bunx`，绕开 shim 解析。
 */
const ARGV_TASKS = {
  test: ["x", "vitest", "run"],
  "test:coverage": ["x", "vitest", "run", "--coverage"],
} as const

export type WebTask = keyof typeof SCRIPT_TASKS | keyof typeof ARGV_TASKS

export function isWebTask(value: string): value is WebTask {
  return value in SCRIPT_TASKS || value in ARGV_TASKS
}

export const WEB_TASKS = [
  ...Object.keys(SCRIPT_TASKS),
  ...Object.keys(ARGV_TASKS),
]

/** 单端串行任务：返回 argv、执行目录与子进程环境 */
export function taskCommand(
  task: WebTask,
  appId: string
): { argv: string[]; cwd: string; env: Record<string, string | undefined> } {
  if (task in ARGV_TASKS) {
    return {
      argv: [process.execPath, ...ARGV_TASKS[task as keyof typeof ARGV_TASKS]],
      cwd: path.join(ROOT, "apps", appId),
      env: { ...process.env, NODE_ENV: "test" },
    }
  }
  return {
    argv: [
      process.execPath,
      "--filter",
      appId,
      SCRIPT_TASKS[task as keyof typeof SCRIPT_TASKS],
    ],
    cwd: ROOT,
    env: { ...process.env },
  }
}

/** dev：api + 所有端并发，交给 concurrently 打前缀 */
export function devArgv(apps: WebApp[]): string[] {
  return [
    process.execPath,
    "x",
    "concurrently",
    "-n",
    ["api", ...apps.map((a) => a.id)].join(","),
    // 内层命令字符串交给 concurrently，它在 win32 显式走 cmd.exe（会搜 PATHEXT），
    // 所以这里的裸 bun 能命中 .cmd shim，不需要 execPath。
    "bun --filter api dev",
    ...apps.map((a) => `bun --filter ${a.id} dev`),
  ]
}

async function main(): Promise<number> {
  const task = process.argv[2]
  if (!task || !isWebTask(task)) {
    console.error(
      `用法：bun run scripts/run-web-task.ts <${WEB_TASKS.join(" | ")}>`
    )
    return 1
  }

  const apps = readWebApps(ROOT)

  if (task === "dev") {
    console.log(
      apps
        .map((a) => `  ${a.title} → http://localhost:${a.devPort}${a.base}`)
        .join("\n")
    )
    return await Bun.spawn(devArgv(apps), {
      cwd: ROOT,
      stdio: ["inherit", "inherit", "inherit"],
    }).exited
  }

  for (const app of apps) {
    const { argv, cwd, env } = taskCommand(task, app.id)
    const code = await Bun.spawn(argv, {
      cwd,
      env,
      stdio: ["inherit", "inherit", "inherit"],
    }).exited
    if (code !== 0) {
      console.error(`❌ ${app.id} 的 ${task} 失败（exit ${code}）`)
      return code
    }
  }
  return 0
}

if (import.meta.main) {
  process.exit(await main())
}
