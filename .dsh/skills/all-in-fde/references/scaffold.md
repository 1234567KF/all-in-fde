# 起架（scaffold）

把空目录变成能跑的项目。**用现成脚手架，不自建**——这条边界靠坐标契约执行，而不是靠自觉。

## 什么时候用

票已切好、项目目录还没初始化。

## 脚手架坐标（唯一来源，不许自建）

起架前必须先解析坐标：

```bash
node <技能目录>/scripts/starter-info.mjs              # 打印生效坐标与来源
node <技能目录>/scripts/starter-info.mjs --check-reach # 顺带探测可达性
```

查找顺序（先命中先用）：

1. `<工作区>/.fde/starter.json` —— 项目级，随项目走
2. `~/.dsh/all-in-fde/starter.json` —— 本机级，团队默认
3. 环境变量 `FDE_STARTER_JSON` —— 指向任意 JSON
4. **本技能自带的完整副本** `.dsh/starter/liquid-glass-starter` —— 前三个都没有时自动使用，开箱即用、零配置。该副本是可直接修改的完整源码，需要定制时直接改即可。

坐标必须含：`name`、`scaffoldCmd`、`moduleCmd`、`checkCmd`；`localPath` 或 `repo` 二选一（有 `localPath` 就用本机完整副本，运行期零网络）；远程取法再加 `fetch.git` 或 `fetch.archive`；多端再加 `webAppsCmd`。

**没有坐标时唯一正确的动作是停下来问**（脚本退出码 3）：用哪个脚手架、仓库地址、分支、取法、生成命令、模块命令、门禁命令。拿到后写进配置再开工。**不许按默认栈自建**——这正是本技能吃过的一次亏。

## 怎么做

1. **解析坐标**：跑上面的命令，记下 `name@ref`，E3 证据要用。
2. **取脚手架**：直接用 `localPath` 的本机完整副本（运行期零网络）；没有本机副本才走 `fetch.git`，再没有就下 `fetch.archive` 解压到 `.fde-tmp/starter/`。副本含 CI、部署与端口分配器，但**端口分配默认关闭**：用模板端口 11070；确需自动分配时加 `--allow-remote-ports`（仅内网环境可用）。
3. **生成项目**：执行 `scaffoldCmd`，替换 `<name>` 与 `<dir>`；多端项目用 `webAppsCmd`，H5 这类无侧边栏的入口用空壳参数。
4. **起服务**：端口写进配置，不靠口头约定。
5. **跑空门禁**：`checkCmd` 退出 0。
6. **写证据**：`evidence/E3-*.json` 必须含 `starter`（`name@ref`）或 `skipped` 加原因。
7. **落坐标与端口**：把实际用的 `name@ref`、`localPath`、`checkCmd`、`moduleCmd` 与端口写进 `<工作区>/.fde/starter.json`（项目级，随项目走）：

```json
{
  "name": "liquid-glass-starter",
  "ref": "<commit 或版本>",
  "localPath": "/abs/path/to/starter",
  "scaffoldCmd": "<从坐标里原样复制，替换 <name> 与 <dir>>",
  "moduleCmd": "bun run gen:module --name <name> --label <label>",
  "checkCmd": "bun run check",
  "ports": { "api": 3000, "web": 5173, "h5": 5174 }
}
```

   下次会话不用再问「用哪个脚手架、跑哪个端口」；端口漂移（v1 用 8099、v2 用 5173）就是靠这份配置避免的。

## 什么算完

- E0 全 PASS（或 SKIP 已写理由）；
- 空项目 `checkCmd` 退出 0；
- E3 证据含 `starter` 或 `skipped`；
- 首页与登录可用；
- `.fde/starter.json` 已写（坐标 + 端口），下次会话可直接复用。

## 起架之后

生成完项目、准备写票时，先读 `references/starter-map.md`：哪类改动进 `apps/api`、哪类进 `packages/ui`、哪些必须走模块生成器，以及两处约定（规格模板二选一、模块实现归谁）。

## 常见错

- **没解析坐标就按默认栈手写**：本次真实事故——多花一份自建脚手架的工，还丢了白盒组件、契约单源与架构门禁。
- **假设内网一定可达**：本机副本就是为了不依赖内网；先看 `localPath`，不要上手就 clone。
- **坐标只在对话里**：下次会话还得再问一遍。落进 `.fde/starter.json`。
- **端口漂移**：约定端口写进配置，别靠口头。
- **跳过空门禁**：空项目不绿，后面所有绿都不可信。
- **自建了却不说**：确需自建，就在 E3 记 `skipped` 与原因，并在 brief 写明改用哪套栈。
