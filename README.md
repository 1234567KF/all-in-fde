# 技能库

一个可以直接下载使用的 DSH 工作区：`.dsh/skills/` 里放技能，`.dsh/bundles/` 里放子代理预设。仓库根就是 `.dsh` 的上级目录，下载到目标位置后 DSH 直接加载，不需要再复制、再安装。

## 当前状态

- 远端：<https://github.com/1234567KF/all-in-fde>，已公开，分支 `main`，标签到 `v0.4.0`。
- 9 个技能、1 个预设包在版本控制内，装好即用。
- **`dashi-ppt` 和 `ai-flavor-guard` 没有许可证，但已经随仓库公开**。这是当前最需要处理的事，见 [NOTICE.md](NOTICE.md)。

## 安装

一条命令，落到目标项目根目录：

```powershell
npx giget@latest gh:1234567KF/all-in-fde "<项目路径>"
```

得到：

```text
<项目路径>\.dsh\
├── skills\      9 个技能，含各自的脚本与依赖
└── bundles\     fde-presets 子代理预设
```

不用 clone、不用打包、不用二次复制。全局安装、单个技能、更新与卸载见 [INSTALL.md](INSTALL.md)。

## 目录结构

```text
.
├── .dsh/
│   ├── skills/              技能本体，一个技能一个目录
│   │   ├── all-in-fde/      入口技能
│   │   ├── ai-flavor-guard/
│   │   ├── token-budget/
│   │   ├── ponytail/
│   │   ├── rea-video/
│   │   ├── dashi-ppt/
│   │   ├── guizang-ppt/
│   │   ├── html-ppt/
│   │   └── ppt-master/
│   └── bundles/fde-presets/ DSH 子代理预设（fde-lead / fde-worker / fde-qa）
├── SKILLS.md                技能索引
├── skills.json              机器可读清单：版本、许可、上游、指纹
├── scripts/                 校验、索引生成、临时目录清理
├── docs/                    技能规范、版本策略、发布清单
├── .github/                 PR 模板与 CI 校验
├── .tmp/                    临时产物，可整目录清空（不进版本库）
├── archive/                 归档文档（不进版本库）
├── deliverables/            交付产物（不进版本库）
├── tools/                   本地工具（不进版本库）
└── .dsh/ 下其他目录          会话、备份等运行数据（不进版本库）
```

## 技能清单

| 技能 | 版本 | 许可证 | 上游 |
| --- | --- | --- | --- |
| `all-in-fde` | 0.1.0 | MIT | 自研（入口技能） |
| `ai-flavor-guard` | 0.1.0 | 未声明 | 本地自研 |
| `token-budget` | 0.2.0 | MIT | 自研（预算层） |
| `ponytail` | 5.3.3 | MIT | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| `rea-video` | 0.1.0 | Apache-2.0 | [JuneYaooo/rea-video](https://github.com/JuneYaooo/rea-video) |
| `dashi-ppt` | 0.4.14 | 未声明 | 本地安装包 |
| `guizang-ppt` | 0.1.0 | AGPL-3.0 | [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) |
| `html-ppt` | 0.1.0 | MIT | [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill) |
| `ppt-master` | 6.9.0 | MIT | [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master) |

## 为什么只有一份

仓库里只有 `.dsh/skills/` 一份技能，没有 `skills/` 之类的源码副本，也没有 `dist/` 打包产物：

- 改技能就是改运行时，不存在「改了一边忘了另一边」；
- 下载即部署，不需要同步脚本、提交钩子或安装器；
- 依赖跟着技能走：`token-budget` 自带 `vendor/dsh-cost`，`giget` 下载完直接能跑。

运行时临时装的、不属于本仓库的技能（例如 `graphify`）在 `.gitignore` 里按名字排除，不会混进提交。

## 常用命令

需要 Node.js 18 及以上，以及一个可用的 `git`：

```powershell
git status
git log --oneline --decorate
git tag -n
```

校验与索引：

```powershell
node scripts/check-skills.mjs            # 元数据与索引一致性
node scripts/sync-index.mjs              # 重新生成 skills.json
node scripts/check-links.mjs             # Markdown 相对链接
node scripts/check-public-artifacts.mjs  # 对外产物里不许有内网地址、本机路径
```

## 临时产物

所有中间产物统一放 `.tmp/`，不进版本库，可以整目录清空：

```powershell
node scripts/clean-tmp.mjs                    # 先看有哪些、占多大
node scripts/clean-tmp.mjs --all              # 全部删掉，保留 README
node scripts/clean-tmp.mjs --older-than 7     # 只删 7 天前的
node scripts/clean-tmp.mjs --legacy --all     # 连根目录旧式 .tmp-* 一起清
```

定时清理的写法见 [.tmp/README.md](.tmp/README.md)。

## 新增或更新技能

1. 在 `.dsh/skills/` 下按 [docs/skill-spec.md](docs/skill-spec.md) 建目录，至少放 `SKILL.md`、`META.json`、`PROVENANCE.md`、`CHANGELOG.md` 四个文件。
2. 改 `SKILL.md` 的 `name` 和 `description`，`META.json` 的版本号、许可证、上游。
3. 在 `CHANGELOG.md` 顶部加一条同版本号的记录。
4. 跑 `node scripts/check-skills.mjs`、`node scripts/check-links.mjs`、`node scripts/check-public-artifacts.mjs`，再跑 `node scripts/sync-index.mjs`。
5. 提交，格式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

技能目录必须自包含：需要外部依赖的，把依赖放进技能自己的子目录（例如 `token-budget/vendor/dsh-cost`），不要引用仓库外的路径——别人只下载 `.dsh/` 时，仓库其他部分不在场。

## 许可证

仓库根的 [LICENSE](LICENSE)（MIT）只覆盖自写文件：文档、脚本、CI 配置，以及各技能目录下新增的 `META.json`、`PROVENANCE.md`、`CHANGELOG.md`。`.dsh/skills/` 里的技能本体沿用各自目录内的许可证，详见 [NOTICE.md](NOTICE.md)。
