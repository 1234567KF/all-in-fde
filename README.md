# 技能库

给一组 Agent 技能做版本归档：一个技能一个目录，各自带版本号、变更记录和来源说明。方案文档、PPT 产物、临时脚本不放在这个仓库里。

## 当前状态

- 本地 Git 仓库已建立，首次提交已完成，没有任何远端。
- 5 个技能已归档。其中 `ai-flavor-guard` 和 `dashi-ppt` 缺许可证，公开前必须处理，见 [NOTICE.md](NOTICE.md)。
- 发布前要做的事写在 [docs/release.md](docs/release.md)。

## 目录结构

```text
.
├── skills/                  技能本体，一个技能一个目录
│   ├── README.md            技能索引
│   ├── skills.json          机器可读清单：版本、许可、上游、指纹
│   ├── ai-flavor-guard/
│   ├── dashi-ppt/
│   ├── guizang-ppt/
│   ├── html-ppt/
│   └── ppt-master/
├── templates/skill/         新技能模板，复制改名即可用
├── scripts/                 校验脚本与清单生成脚本
├── docs/                    技能规范、版本策略、发布清单
├── .github/                 PR 模板与 CI 校验
├── archive/                 早期方案、白皮书、临时脚本（不进版本库）
├── deliverables/            PPT 交付产物（不进版本库）
├── tools/                   本地工具（不进版本库）
└── .dsh/                    已安装技能与备份（不进版本库）
```

## 技能清单

| 技能 | 版本 | 许可证 | 上游 |
| --- | --- | --- | --- |
| `ai-flavor-guard` | 0.1.0 | 未声明 | 本地自研 |
| `dashi-ppt` | 0.4.14 | 未声明 | 本地安装包 |
| `guizang-ppt` | 0.1.0 | AGPL-3.0 | [op7418/guizang-ppt-skill](https://github.com/op7418/guizang-ppt-skill) |
| `html-ppt` | 0.1.0 | MIT | [lewislulu/html-ppt-skill](https://github.com/lewislulu/html-ppt-skill) |
| `ppt-master` | 6.9.0 | MIT | [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master) |

## 常用命令

本机没有全局 git，用的是 MinGit：

```powershell
$git = 'C:\Users\KF\.qoder\bin\git\cmd\git.exe'
& $git status
& $git log --oneline --decorate
& $git tag -n
```

校验技能元数据与索引是否一致（需要 Node.js 18 及以上）：

```powershell
node scripts/check-skills.mjs     # 只读检查，异常时退出码非 0
node scripts/sync-index.mjs       # 重新生成 skills/skills.json
```

## 新增或更新技能

1. 复制 `templates/skill/` 到 `skills/<name>/`。
2. 改 `SKILL.md` 的 `name` 和 `description`，`META.json` 的版本号、许可证、上游。
3. 在 `CHANGELOG.md` 顶部加一条同版本号的记录。
4. 跑 `node scripts/check-skills.mjs`，再跑 `node scripts/sync-index.mjs`。
5. 提交，格式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

仓库根的 [LICENSE](LICENSE)（MIT）只覆盖自写文件：文档、模板、脚本、CI 配置，以及各技能目录下新增的 `META.json`、`PROVENANCE.md`、`CHANGELOG.md`。`skills/` 里的技能本体沿用各自目录内的许可证，详见 [NOTICE.md](NOTICE.md)。
