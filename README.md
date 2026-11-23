# all-in-fde 技能库

一个 DSH 工作区：把一段需求推进到可验收的小型 IT 系统。AI 读完本文件和 [AGENTS.md](AGENTS.md) 即可自主执行，人只在三个触点拍板。

## 给人看：你需要做什么

1. **安装**（一次性）：`npx giget@latest gh:1234567KF/all-in-fde "<项目路径>"`
2. **启动 watch**（一次性，后台跑）：`node tools/dsh-cost/bin/dsh-cost.mjs watch`
3. **核实定价表里的占位单价**（一次性）：打开 `tools/dsh-cost/pricing.json`，搜 `_needVerify`，从各平台控制台填真实值，然后 `node .dsh/skills/token-budget/scripts/sync-vendor.mjs`

之后所有命令由 AI 自动执行。你只需要在以下三个时刻做决定：

| 触点 | AI 给你什么 | 你做什么 |
| --- | --- | --- |
| 理解卡 / 提案卡 | HTML 卡片 + 问题清单 | 确认方向、回答疑问 |
| 采集表审定 | xlsx + 核验戳脚本结果 | 逐条审定、盖章 |
| 票面走查 | 切片后的任务票 | 调整优先级、批准并行 |

其余步骤（PRD、spec、封版、实现、验收、看板）AI 按技能流程自动推进。说"统计"或"看板"即出计费面板。

## 给 AI 看：首次进入怎么做

读 [AGENTS.md](AGENTS.md)。它会告诉你：

- 怎么判断是否已安装、怎么一键 bootstrap
- 怎么起新项目（选 FDE 主控预设，一句话说需求）
- 计费技能的自动触发时机
- 改动边界（哪些能改、哪些不能改）

**不要让人敲命令**。除了上面"给人看"的三步，其余操作你自己执行。

## 当前状态

- 远端：<https://github.com/1234567KF/all-in-fde>，分支 `main`，标签到 `v0.8.0`
- 5 个技能、1 个预设包、1 个脚手架底座，整包约 5 MB
- 许可证见 [NOTICE.md](NOTICE.md)，公开分发无阻塞项
- 4 个 PPT 类技能体积过大已移出分发，见 [SKILLS.md](SKILLS.md)

## 安装

```powershell
npx giget@latest gh:1234567KF/all-in-fde "<项目路径>"
```

得到：

```text
<项目路径>\.dsh\
├── skills\      5 个技能（含脚本与 vendor 依赖）
├── bundles\     fde-presets 子代理预设
└── starter\     liquid-glass-starter 脚手架底座
```

不用 clone、不用打包、不用二次复制。全局安装与卸载见 [INSTALL.md](INSTALL.md)。

> **注意**：`skills.json` 和 `SKILLS.md` 是仓库级索引文件，供开发时的校验脚本使用。giget 只拉 `.dsh/` 目录，这两个文件不会被下载到用户机器上。

## 技能清单

| 技能 | 版本 | 许可证 | 上游 |
| --- | --- | --- | --- |
| `all-in-fde` | 0.7.2 | MIT | 自研（入口技能） |
| `ai-flavor-guard` | 0.1.1 | MIT | 本地自研 |
| `token-budget` | 0.4.3 | MIT | 自研（预算层） |
| `ponytail` | 5.3.3 | MIT | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| `rea-video` | 0.1.0 | Apache-2.0 | [JuneYaooo/rea-video](https://github.com/JuneYaooo/rea-video) |

`dashi-ppt`、`guizang-ppt`、`html-ppt`、`ppt-master` 不随下载分发，原因与找回方式见 [SKILLS.md](SKILLS.md)。

## 目录结构

```text
all-in-fde/                              # 仓库根 = .dsh 上级，giget 下载即用
├── .dsh/
│   ├── skills/                          # 技能本体（运行时唯一一份）
│   │   ├── all-in-fde/                  # 入口技能 v0.7.0
│   │   │   ├── SKILL.md                 # 路由：角色、先读现场、七动作
│   │   │   ├── META.json                # 版本/许可/上游的唯一真源
│   │   │   ├── references/              # 九个动作细则，用到才加载
│   │   │   │   ├── understand.md        # 收活·理解卡+提案卡
│   │   │   │   ├── intake.md            # 收活·出采集表
│   │   │   │   ├── spec.md              # PRD→spec→封版（含固定专题）
│   │   │   │   ├── slice.md             # 切片与派发
│   │   │   │   ├── scaffold.md          # 起架：脚手架坐标契约
│   │   │   │   ├── implement.md         # 逐单实现+自测+证据
│   │   │   │   ├── verify.md            # 验收：复核+冷启动+E2E
│   │   │   │   ├── delivery.md          # 交付三件套+retro
│   │   │   │   ├── checklist.md         # 五道阻断门+31条ID
│   │   │   │   └── starter-map.md       # 脚手架对照+禁区清单
│   │   │   ├── scripts/                 # 执法器（agent 只调用不代写）
│   │   │   └── assets/                  # 模板件（采集表/spec骨架/PRD清单）
│   │   ├── token-budget/                # 预算层 + vendor/dsh-cost
│   │   ├── ponytail/                    # 最小改动纪律
│   │   ├── ai-flavor-guard/             # 中文去 AI 味
│   │   └── rea-video/                   # 视频逆向拆解
│   ├── bundles/fde-presets/             # fde-lead / fde-worker / fde-qa / fde-budget
│   └── starter/liquid-glass-starter/    # 本地脚手架底座
├── AGENTS.md                            # AI 工作区说明（必读）
├── README.md                            # 本文件
├── SKILLS.md / skills.json              # 仓库级索引（giget 不拉）
├── scripts/                             # 仓库级校验（giget 不拉）
├── tools/                               # 本地工具如 dsh-cost（gitignored）
└── docs/                                # 规范与方案文档

# 跑一次交付后，目标工作区长这样（与上面互不重叠）：
<项目工作区>/
├── .fde/                                # 正式产物，进版本库
│   ├── brief.md                         # 五节需求摘要
│   ├── starter.json                     # 脚手架坐标
│   ├── prd.md 或 prd/                   # 一级真源
│   ├── spec/<module>.md + 固定专题      # 二级真源
│   ├── tickets/<票号>-<slug>.md          # 任务票
│   ├── cards/E6-*.md                    # 人填验收卡
│   ├── evidence/E*-*.json               # 脚本/卡片产出的证据
│   └── handoff/ retro.md
└── .fde-tmp/                            # 截图/日志/草稿，随时可删
```

**三条规则**（比树本身更重要）：

1. **依赖方向**：`SKILL.md` 只做路由；`references/` 是动作细则，用到才加载；`scripts/` 是执法器，agent 只调用不代写产物；`assets/` 是模板不是产物。
2. **两个临时目录**：仓库根 `.tmp/` 给仓库开发用；工作区根 `.fde-tmp/` 给每次交付用，由 `ensure-tmp.mjs` 写进 `.git/info/exclude`，绝不改对方 `.gitignore`。
3. **`.fde/` vs `.fde-tmp/`**：前者是交付物与证据（进版本库、可回溯），后者是调试残留（收尾前确认 `git ls-files .fde-tmp` 为空）。

## 为什么只有一份

仓库里只有 `.dsh/skills/` 一份技能，没有源码副本或 dist 产物：

- 改技能就是改运行时，不存在"改了一边忘了另一边"
- 下载即部署，不需要同步脚本或安装器
- 依赖跟着技能走：`token-budget` 自带 `vendor/dsh-cost`，下载完直接能跑

## 开发者命令

以下命令面向**修改本仓库的开发者**，不是给用户用的。AI 在改完技能后自动执行校验，不需要人敲。

需要 Node.js ≥ 18 和 git。

```powershell
# 校验
node scripts/check-skills.mjs            # 元数据与索引一致性
node scripts/sync-index.mjs              # 重新生成 skills.json
node scripts/check-links.mjs             # Markdown 相对链接
node scripts/check-public-artifacts.mjs  # 对外产物无内网地址/本机路径

# 计费
node tools/dsh-cost/bin/dsh-cost.mjs watch    # 启动增量同步（后台）
node tools/dsh-cost/bin/dsh-cost.mjs status   # 检查 watch 状态
node .dsh/skills/token-budget/scripts/sync-vendor.mjs  # pricing.json 改完同步到 vendor

# 清理
node scripts/clean-tmp.mjs               # 查看临时产物
node scripts/clean-tmp.mjs --all         # 全部清空
```

## 新增或更新技能

1. 在 `.dsh/skills/` 下按 [docs/skill-spec.md](docs/skill-spec.md) 建目录
2. 放 `SKILL.md`、`META.json`、`PROVENANCE.md`、`CHANGELOG.md`
3. 改版本号、许可证、上游
4. 跑校验四件套 + `sync-index.mjs`
5. 提交，格式见 [CONTRIBUTING.md](CONTRIBUTING.md)

技能目录必须自包含：外部依赖放进技能子目录（如 `vendor/`），不引用仓库外路径。

## 许可证

仓库根 [LICENSE](LICENSE)（MIT）覆盖自写文件。`.dsh/skills/` 里的技能沿用各自目录内的许可证，详见 [NOTICE.md](NOTICE.md)。
