# 技能库

给一组 Agent 技能做版本归档：一个技能一个目录，各自带版本号、变更记录和来源说明。方案文档、PPT 产物、临时文件不放在这个仓库里。

## 当前状态

- 远端：<https://github.com/1234567KF/all-in-fde>，已公开，分支 `main`，标签 `v0.1.0`、`v0.1.1`。
- 6 个技能纳入版本控制；`skills/` 与运行时 `.dsh/skills/` 由脚本同步，不再各改各的。
- **`dashi-ppt` 和 `ai-flavor-guard` 没有许可证，但已经随仓库公开**。这是当前最需要处理的事，见 [NOTICE.md](NOTICE.md)。

## 目录结构

```text
.
├── skills/                  技能本体，一个技能一个目录
│   ├── README.md            技能索引
│   ├── skills.json          机器可读清单：版本、许可、上游、指纹
│   ├── ai-flavor-guard/
│   ├── token-budget/
│   ├── dashi-ppt/
│   ├── guizang-ppt/
│   ├── html-ppt/
│   └── ppt-master/
├── scripts/                 校验、索引生成、运行时同步、临时目录清理
├── .githooks/               提交后自动同步运行时的钩子
├── docs/                    技能规范、版本策略、发布清单、运行时同步说明
├── .github/                 PR 模板与 CI 校验
├── .tmp/                    临时产物，可整目录清空（不进版本库）
├── archive/                 归档文档（不进版本库）
├── deliverables/            交付产物（不进版本库）
├── tools/                   本地工具（不进版本库）
└── .dsh/                    运行时技能目录（不进版本库）
```

## 技能清单

| 技能 | 版本 | 许可证 | 上游 |
| --- | --- | --- | --- |
| `ai-flavor-guard` | 0.1.0 | 未声明 | 本地自研 |
| `token-budget` | 0.1.0 | MIT | 自研（预算层） |
| `dashi-ppt` | 0.4.14 | 未声明 | 本地安装包 |
| `guizang-ppt` | 0.1.0 | AGPL-3.0 | [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) |
| `html-ppt` | 0.1.0 | MIT | [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill) |
| `ppt-master` | 6.9.0 | MIT | [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master) |

## 仓库与运行时

`.dsh/skills/` 是 DSH 真正加载的目录，`skills/` 是版本库里的副本。两份靠一个方向同步，改一处就能对齐：

```powershell
node scripts/sync-runtime.mjs            # 仓库 -> .dsh/skills
node scripts/sync-runtime.mjs --check    # 只看差异，有差异时退出码 1
node scripts/sync-runtime.mjs --pull     # 运行时 -> 仓库（在运行时改过东西时用）
node scripts/sync-runtime.mjs --global   # 部署到 ~/.dsh/skills
```

装上仓库自带的钩子后，每次提交都会自动同步一次：

```powershell
$git config core.hooksPath .githooks
```

同步有两条硬规则：`node_modules`、`dist`、`output` 等运行产物不参与；运行时目录若是目录联接（`ai-flavor-guard` 就指向 `all-in-md`），一律跳过，避免写到别的仓库里去。细节见 [docs/runtime-sync.md](docs/runtime-sync.md)。

## 常用命令

本机没有全局 git，用的是 MinGit：

```powershell
$git = 'C:\Users\KF\.qoder\bin\git\cmd\git.exe'
& $git status
& $git log --oneline --decorate
& $git tag -n
```

校验技能元数据与索引（需要 Node.js 18 及以上）：

```powershell
node scripts/check-skills.mjs     # 只读检查，异常时退出码非 0
node scripts/sync-index.mjs       # 重新生成 skills/skills.json
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

1. 按 [docs/skill-spec.md](docs/skill-spec.md) 建目录，至少放 `SKILL.md`、`META.json`、`PROVENANCE.md`、`CHANGELOG.md` 四个文件。
2. 改 `SKILL.md` 的 `name` 和 `description`，`META.json` 的版本号、许可证、上游。
3. 在 `CHANGELOG.md` 顶部加一条同版本号的记录。
4. 跑 `node scripts/check-skills.mjs`，再跑 `node scripts/sync-index.mjs`。
5. 跑 `node scripts/sync-runtime.mjs` 把改动推给 `.dsh/skills`。
6. 提交，格式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

仓库根的 [LICENSE](LICENSE)（MIT）只覆盖自写文件：文档、脚本、CI 配置，以及各技能目录下新增的 `META.json`、`PROVENANCE.md`、`CHANGELOG.md`。`skills/` 里的技能本体沿用各自目录内的许可证，详见 [NOTICE.md](NOTICE.md)。
