/**
 * test:ci —— 并行执行 CI 的测试套件。
 *
 * CI runner 有 16 核，串行跑这些套件要 ~15s（web 覆盖率 4.4s、scripts 5s、
 * api 1.6s…），并行后墙钟取决于最慢的套件。各套件输出先缓冲、结束后按顺序打印：
 * 既避免多进程日志交错，又保证失败信息完整可见（任一失败整体非 0 退出）。
 *
 * 只有 web-coverage 出 istanbul 表格：.gitlab-ci.yml 的 coverage 正则按 4 列表格
 * 抓行覆盖率，多个包同时出表会让抓取归属不确定，共享包因此只跑测试不出覆盖率。
 *
 * 用法：`bun run test:ci`（CI 与本地同一条路径）。
 */
const SUITES = [
  { name: "eslint-rules", command: ["run", "test:eslint"] },
  { name: "scripts", command: ["run", "test:scripts"] },
  { name: "shared", command: ["run", "test:shared"] },
  { name: "ui", command: ["run", "test:ui"] },
  { name: "web-core", command: ["run", "test:web-core"] },
  { name: "web-coverage", command: ["run", "test:coverage"] },
  { name: "api-coverage", command: ["run", "test:api:coverage"] },
] as const

interface SuiteResult {
  name: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

const results: SuiteResult[] = await Promise.all(
  SUITES.map(async ({ name, command }) => {
    const startedAt = performance.now()
    const proc = Bun.spawn([process.execPath, ...command], {
      stdout: "pipe",
      stderr: "pipe",
      // NODE_ENV=test 必须显式给：`bun run scripts/x.ts` 会隐式设 production，
      // 继承下去 react-dom 走 production 分支（没有 act）让 ui / web-core 全红，
      // api 的 index.test.ts 也会因 production 启用 serveStatic 而读不到 web-apps.json。
      env: { ...process.env, NODE_ENV: "test", NO_COLOR: "1" },
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    return {
      name,
      exitCode,
      stdout,
      stderr,
      durationMs: performance.now() - startedAt,
    }
  })
)

let failed = false
for (const result of results) {
  const seconds = (result.durationMs / 1000).toFixed(1)
  console.log(
    `\n───── ${result.name}  ${seconds}s  exit=${result.exitCode} ─────`
  )
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.exitCode !== 0) failed = true
}

const wallSeconds = (
  Math.max(...results.map((r) => r.durationMs)) / 1000
).toFixed(1)
const summary = results
  .map((r) => `${r.name} ${(r.durationMs / 1000).toFixed(1)}s`)
  .join(" · ")
console.log(`\n═══ 并行套件：${summary}（墙钟 ${wallSeconds}s）═══`)
if (failed) process.exit(1)

export {}
