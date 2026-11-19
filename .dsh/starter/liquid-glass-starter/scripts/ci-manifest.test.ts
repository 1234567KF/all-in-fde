/**
 * CI 清单一致性守护：scaffold 的三份文件清单 + 复制排除策略 + .gitlab-ci.yml 的预发布链路。
 *
 * 为什么需要：
 *   ▸ CI_FILES_ALL / CI_FILES_REPLACE / PORT_STAMP_FILES 靠手写维护，新增 compose 文件时
 *     漏改任一份，生成项目会静默缺文件、留着模板项目名、端口没被替换；而 `test:scripts`
 *     只扫 scripts/，覆盖不到 skills/ 下的 scaffold.ts。
 *   ▸ 复制排除策略（lib/template-copy.ts）漏排除 CI 文件，会让模板原件在 init 不带 CI 时
 *     被原样拷进去，导致后续 add-ci 冲突。
 *   ▸ 预发布镜像 tag 分散在 variables / promote-preprod / deploy-preprod / retag /
 *     compose.preprod.yml 五处，任一处漂移都会破坏「预发布跑的镜像 == 晋级的镜像 == prod 的镜像」。
 *
 * 解析方式：scaffold.ts 顶层有副作用不能 import，仓库也没有 yaml 依赖，故三份清单与 yml
 * 用文本解析（与 scripts/lib/long-file-ratchet.ts 依赖字面量形态的先例一致）；改动清单或
 * yml 的书写形态时需同步更新这里的正则。排除策略是零依赖纯模块，直接动态 import 断言行为，
 * 不再 scraping 字面量。
 *
 * 生成项目：没有 skills/ → 清单对照组跳过（排除策略也只在存在时加载）；没启用 CI
 * （无 .gitlab-ci.yml）→ yml 组跳过。yml 组的断言一律不写死项目名与端口，因此 stamp
 * 之后在生成项目里同样成立。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "bun:test"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))
const SCAFFOLD_PATH = path.join(
  REPO_ROOT,
  "skills/project-scaffolder/scripts/scaffold.ts"
)
const CI_PATH = path.join(REPO_ROOT, ".gitlab-ci.yml")
const PREPROD_COMPOSE_PATH = path.join(REPO_ROOT, "compose.preprod.yml")

const scaffoldExists = existsSync(SCAFFOLD_PATH)
const ciExists = existsSync(CI_PATH)

if (!scaffoldExists) {
  console.log(
    "[ci-manifest] 跳过 scaffold 清单对照：生成项目不包含 skills/ 目录（scaffold skill 只在模板仓库存在）"
  )
}
if (!ciExists) {
  console.log("[ci-manifest] 跳过 .gitlab-ci.yml 断言：该项目未启用 CI")
}

/** 抽取 `const NAME = [...]` / `const NAME = new Set([...])` 里的双引号字面量。 */
function stringList(source: string, name: string): string[] {
  const match = new RegExp(
    `const ${name} = (?:new Set\\()?\\[([\\s\\S]*?)\\n\\]`
  ).exec(source)
  if (!match) {
    throw new Error(`scaffold.ts 里找不到 ${name} 清单（书写形态变了？）`)
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

/**
 * 按 0 缩进的 `key:` 切分 yml 顶层块。注释以 # 开头不会误命中，
 * `- |` 里的 shell 内容一律有缩进，因此不会被当成新块。
 */
function topLevelBlocks(yaml: string): Map<string, string> {
  const blocks = new Map<string, string>()
  let current: string | null = null
  let body: string[] = []
  for (const line of yaml.split("\n")) {
    const header = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(line)
    if (header) {
      if (current !== null) blocks.set(current, body.join("\n"))
      current = header[1]
      body = []
    } else if (current !== null) {
      body.push(line)
    }
  }
  if (current !== null) blocks.set(current, body.join("\n"))
  return blocks
}

/** `if:` 与 `when: never` 必须成对出现，只匹配 if 会漏掉「条件写了但没关」。 */
function hasNeverRule(block: string, condition: string): boolean {
  const escaped = condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`- if: ${escaped}[ \\t]*\\n[ \\t]*when: never`).test(block)
}

/** 抽取 job 的全部 `- if:` 条件（注释行以 # 开头，不会命中）。 */
function ruleConditions(block: string): string[] {
  return [...block.matchAll(/^[ \t]*- if: (.+)$/gm)].map((m) => m[1].trim())
}

/** 去掉哨兵关闭规则，剩下的就是「什么情况下这个 job 会跑」。 */
function positiveRules(block: string): string[] {
  return ruleConditions(block).filter((c) => !c.includes("REPLACE_ME"))
}

const scaffoldSource = scaffoldExists ? readFileSync(SCAFFOLD_PATH, "utf8") : ""
const ciFilesAll = scaffoldExists
  ? stringList(scaffoldSource, "CI_FILES_ALL")
  : []
const ciFilesReplace = scaffoldExists
  ? stringList(scaffoldSource, "CI_FILES_REPLACE")
  : []
const portStampFiles = scaffoldExists
  ? stringList(scaffoldSource, "PORT_STAMP_FILES")
  : []
// 排除策略是零依赖纯模块，直接 import 断言行为；生成项目没有 skills/，
// 因此只在 scaffold 存在时动态加载（静态 import 会让生成项目加载本文件即失败）。
// 路径用 string 变量承载：tsc 会解析字面量 import，生成项目缺 skills/ 时即 TS2307；
// 非字面量路径不触发解析，运行时仍由 scaffoldExists 守卫。
const templateCopyPath: string =
  "../skills/project-scaffolder/scripts/lib/template-copy"
const templateCopy = scaffoldExists ? await import(templateCopyPath) : null

/** init 复制时该路径是否被排除（漏排除 = 模板原件泄漏进生成项目）。 */
function excludedFromTemplate(rel: string): boolean {
  if (!templateCopy) {
    throw new Error("生成项目不含 skills/，本组用例应被 skipIf 跳过")
  }
  return templateCopy.isExcludedFromTemplate(rel)
}

const ciSource = ciExists ? readFileSync(CI_PATH, "utf8") : ""
const blocks = topLevelBlocks(ciSource)
const jobNames = [...blocks]
  .filter(([, body]) => /^ {2}script:/m.test(body))
  .map(([name]) => name)

function jobBlock(name: string): string {
  const block = blocks.get(name)
  if (block === undefined) {
    throw new Error(`.gitlab-ci.yml 里找不到 job ${name}`)
  }
  return block
}

function ciVariable(name: string): string {
  const match = new RegExp(`^ {2}${name}: "([^"]*)"$`, "m").exec(ciSource)
  if (!match) {
    throw new Error(`.gitlab-ci.yml 的 variables 里找不到 ${name}`)
  }
  return normalizeMachineValue(match[1])
}

/**
 * 机器级默认值：CI yml 里存的是模板团队的取值（主机、用户、密钥别名、SSH 端口）。
 * 净化副本把这些取值换成了占位符——本测试只守护「形状」与「同源关系」，不守护具体取值，
 * 故读取时统一归一化：ExampleOrg→wecode、2222→63022、/srv/deploy→/home/wecode、密钥别名还原。
 * 这样同一份测试在原始模板与净化副本上都成立，无需维护两个版本。
 */
function normalizeMachineValue(value: string): string {
  return value
    .replaceAll("ExampleOrg", "wecode")
    .replaceAll("2222", "63022")
    .replaceAll("/srv/deploy", "/home/wecode")
    .replaceAll("G_PREPROD_SSH_PKEY", "G_PRE_SERVER_WECODE_SSH_PKEY")
    .replaceAll("G_TEST_SERVER_SSH_PKEY", "G_LOCAL_SERVER_000_SSH_PKEY")
}

/** 从 `$IMAG_REG/<项目名>:<tag>` 取出 tag，避免断言写死项目名。 */
function tagSuffix(variable: string): string {
  const value = ciVariable(variable)
  const sep = value.lastIndexOf(":")
  if (sep < 0) {
    throw new Error(`${variable} 不是 registry/name:tag 形态：${value}`)
  }
  return value.slice(sep + 1)
}

describe.skipIf(!scaffoldExists)("scaffold CI 文件清单", () => {
  it("根目录每份 compose*.yml（除模板专属 compose.self.yml）都进了三份清单且被 init 排除", () => {
    const composes = readdirSync(REPO_ROOT).filter(
      (file) => /^compose.*\.yml$/.test(file) && file !== "compose.self.yml"
    )
    expect(composes.length).toBeGreaterThan(0)
    for (const file of composes) {
      expect(
        ciFilesAll,
        `${file} 缺 CI_FILES_ALL（不会被拷进生成项目）`
      ).toContain(file)
      expect(
        ciFilesReplace,
        `${file} 缺 CI_FILES_REPLACE（会留着模板项目名）`
      ).toContain(file)
      expect(
        portStampFiles,
        `${file} 缺 PORT_STAMP_FILES（端口不会被替换）`
      ).toContain(file)
      expect(
        excludedFromTemplate(file),
        `${file} 未被复制排除策略排除（init 不带 CI 时会原样拷进生成项目）`
      ).toBe(true)
    }
  })

  it("compose.self.yml 只在模板自部署，既不进生成项目也不进 CI 清单", () => {
    // 它是 tmpfs 无记忆部署，泄漏到生成项目会违反「模板部署级别无状态」规则
    expect(excludedFromTemplate("compose.self.yml")).toBe(true)
    expect(ciFilesAll).not.toContain("compose.self.yml")
  })

  it("CI_FILES_ALL 里含模板端口 11070 的文件都进了 PORT_STAMP_FILES", () => {
    for (const rel of ciFilesAll) {
      const abs = path.join(REPO_ROOT, rel)
      expect(existsSync(abs), `CI_FILES_ALL 里的 ${rel} 在模板中不存在`).toBe(
        true
      )
      if (!readFileSync(abs, "utf8").includes("11070")) continue
      expect(
        portStampFiles,
        `${rel} 含 11070 但不在 PORT_STAMP_FILES，生成项目会沿用模板端口`
      ).toContain(rel)
    }
  })
})

describe.skipIf(!ciExists)(".gitlab-ci.yml 预发布链路", () => {
  it("PREPROD_HOST 默认哨兵关闭，各 job 的开关方向正确（空串也算关闭）", () => {
    expect(ciVariable("PREPROD_HOST")).toBe("REPLACE_ME")
    // 只写 !~ /REPLACE_ME/ 会把「变量被清空」误判成已启用：main 停推 registry、
    // prod 去拉不存在的 pre-prod tag。已在真 GitLab dry_run 上验证 /^$|REPLACE_ME/ 的判据。
    // 启用后 main 不再推 registry，pre-prod 上也不重复 build
    expect(
      hasNeverRule(
        jobBlock("push-registry"),
        "$PREPROD_HOST !~ /^$|REPLACE_ME/"
      )
    ).toBe(true)
    expect(
      hasNeverRule(
        jobBlock("build"),
        '$PREPROD_HOST !~ /^$|REPLACE_ME/ && $CI_COMMIT_BRANCH == "pre-prod"'
      )
    ).toBe(true)
    for (const job of ["promote-preprod", "deploy-preprod"]) {
      expect(
        hasNeverRule(jobBlock(job), "$PREPROD_HOST =~ /^$|REPLACE_ME/"),
        `${job} 未配置 PREPROD_HOST 时必须关闭`
      ).toBe(true)
    }
    // retag 在 shell 里选镜像源，判据必须与 rules 一致
    expect(jobBlock("retag")).toContain('""|*REPLACE_ME*)')
  })

  it("预发布默认值对齐团队预发布机，新项目只需配 PREPROD_HOST", () => {
    // 前三项是机器级事实、与项目无关：默认值错了会逼着每个新项目重复配 5 个变量。
    // PREPROD_PATH 由 scaffold 按项目名 stamp，不能钉死模板值，只校验机器级形状。
    expect(ciVariable("PREPROD_PORT")).toBe("63022")
    expect(ciVariable("PREPROD_USER")).toBe("wecode")
    expect(ciVariable("PREPROD_SSH_PKEY")).toBe("$G_PRE_SERVER_WECODE_SSH_PKEY")
    expect(ciVariable("PREPROD_PATH")).toMatch(
      /^\/home\/wecode\/[^/]+-preprod$/
    )
  })

  it("测试机密钥同样走别名变量，换机器时不必改 yml", () => {
    expect(ciVariable("TEST_SSH_PKEY")).toBe("$G_LOCAL_SERVER_000_SSH_PKEY")
    for (const job of ["deploy-test", "restart-test"]) {
      expect(jobBlock(job)).toContain('echo "$TEST_SSH_PKEY" > private_key')
      expect(jobBlock(job)).not.toContain("$G_LOCAL_SERVER_000_SSH_PKEY")
    }
  })

  it("workflow 去重豁免 pre-prod / prod，否则开着下游 MR 时晋级流水线被静默吞掉", () => {
    const workflow = blocks.get("workflow") ?? ""
    expect(workflow).toContain('$CI_COMMIT_BRANCH != "pre-prod"')
    expect(workflow).toContain('$CI_COMMIT_BRANCH != "prod"')
  })

  it("镜像 tag 在 variables / promote / deploy / retag / compose 五处同源", () => {
    const compose = readFileSync(PREPROD_COMPOSE_PATH, "utf8")
    const movingTag = tagSuffix("PREPROD_TAG")
    const shaTag = tagSuffix("PREPROD_SHA_TAG")
    // 手工 ./deploy.sh pre-prod 时的 fallback 必须就是 promote 推的 moving tag
    expect(compose).toContain(`\${PREPROD_IMAGE_TAG:-${movingTag}}`)
    // CI 部署插值成不可变 SHA tag，且 deploy.sh 第一个参数是同一个 tag
    expect(jobBlock("deploy-preprod")).toContain(
      `PREPROD_IMAGE_TAG=${shaTag} ./deploy.sh ${shaTag}`
    )
    const promote = jobBlock("promote-preprod")
    expect(promote).toContain('docker push "$PREPROD_SHA_TAG"')
    expect(promote).toContain('docker push "$PREPROD_TAG"')
    // 三分支模式下 prod 必须复用 pre-prod 晋级的镜像，而不是 main 的 $SHA
    expect(jobBlock("retag")).toContain('SRC="$PREPROD_SHA_TAG"')
  })

  it("build 产出 image.sha，promote 跨流水线取 main，预发布机不接收 tar", () => {
    expect(jobBlock("build")).toMatch(/artifacts:[\s\S]*?- image\.sha/)
    expect(jobBlock("promote-preprod")).toMatch(/needs:[\s\S]*?ref: main/)
    // 预发布机在外网，走 registry 拉取；SCP tar 是内网测试机的路径
    expect(jobBlock("deploy-preprod")).not.toMatch(/scp[^\n]*image\.tar\.gz/)
    expect(jobBlock("deploy-preprod")).not.toContain("compose.self.yml")
  })

  it("各 job 的正向规则限定分支，且不留被上一条覆盖的死规则", () => {
    // 不限分支的 schedule / web 会让 prod 上的定时流水线白构建一遍，
    // 并把 test-latest 覆盖成 prod 产物（还与 retag 推 latest 竞态）
    expect(positiveRules(jobBlock("build"))).toEqual([
      '$CI_COMMIT_BRANCH == "main"',
    ])
    expect(positiveRules(jobBlock("push-registry"))).toEqual([
      '$CI_COMMIT_BRANCH == "main"',
    ])
    // retag 只在 prod 上存在：deploy-prod 若放宽来源，needs 会悬空、整条流水线创建失败
    expect(positiveRules(jobBlock("retag"))).toEqual([
      '$CI_COMMIT_BRANCH == "prod"',
    ])
    expect(positiveRules(jobBlock("deploy-prod"))).toEqual([
      '$CI_COMMIT_BRANCH == "prod"',
    ])
    for (const job of ["promote-preprod", "deploy-preprod"]) {
      expect(positiveRules(jobBlock(job))).toEqual([
        '$CI_COMMIT_BRANCH == "pre-prod"',
      ])
    }
  })

  it("deploy-preprod 在远端校验 .env 内容，拒默认密码与 dev 模式，不外传文件", () => {
    const block = jobBlock("deploy-preprod")
    // 只查文件存在挡不住「从测试机复制来的 admin123 .env」与 NODE_ENV=development：
    // 前者把默认密码暴露公网，后者跳过全部生产守卫并关闭静态托管（表现为 60s 超时）
    expect(block).toContain(
      "for key in FRONTEND_URL JWT_SECRET SEED_ADMIN_PASSWORD"
    )
    // NODE_ENV 不要求必填（镜像自带 production），只有显式写了才校验
    expect(block).toContain(
      "if grep -q '^NODE_ENV=' .env && ! grep -Eq '^NODE_ENV=\"?production\"?$' .env"
    )
    expect(block).toContain(
      `'^SEED_ADMIN_PASSWORD="?(admin123|change-me-in-production)"?$'`
    )
    // 校验必须在远端跑、只回传结论：把 .env 拉回 CI 会让密钥进日志
    expect(block).toContain("<<'ENV_CHECK'")
    expect(block).not.toMatch(/scp[^\n]*\.env/)
    // PORT 是容器内监听端口，compose 映射与健康检查都写死 3000；填别的值容器能起但对外不通
    expect(block).toContain(`'^PORT="?3000"?$'`)
  })

  it("CI 里所有 ssh/scp 都带 SSH_OPTS，认证异常时快速失败而不是挂到 job 超时", () => {
    // 实测：ssh 不带 BatchMode 时，落在需要交互输入的端口上会无限等待，
    // 且 stderr 被 2>/dev/null 吞掉后毫无线索（曾挂死 14 分钟）
    expect(ciSource).toContain(
      'SSH_OPTS: "-o BatchMode=yes -o ConnectTimeout=15"'
    )
    const bare = ciSource
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .filter((line) => /\b(ssh|scp) -[pP] /.test(line))
      .filter((line) => !line.includes("$SSH_OPTS"))
    expect(bare).toEqual([])
  })

  it("deploy-preprod 的完成回显读远端 .env 的真实 WEB_PORT", () => {
    // scaffold 写进 yml 的端口只是默认值；部署目录 .env 可以改成别的，
    // 回显跟着 yml 走会把运维指向错误端口
    const block = jobBlock("deploy-preprod")
    expect(block).toContain("sed -n 's/^WEB_PORT=//p'")
  })

  it("所有本地 needs 都指向存在的 job（指向被 rules 排除的 job 会让流水线创建失败）", () => {
    // 只匹配 `- job:` 形态：跨项目 need 的 `job: build` 挂在 project/ref 下，不是本地 job
    // 边界：本条只校验存在性，不模拟 rules 求值。GitLab ci/lint 的 dry_run 按项目
    // 默认分支求值 CI_COMMIT_BRANCH，验证不了分支组合，只能靠真实流水线。
    const referenced = [
      ...ciSource.matchAll(/^[ \t]+- job: ([A-Za-z0-9_-]+)[ \t]*$/gm),
    ].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(0)
    for (const name of referenced) {
      expect(jobNames, `needs 指向不存在的 job：${name}`).toContain(name)
    }
  })
})
