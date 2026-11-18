# 第三方技能与许可声明

本仓库根目录的 `LICENSE`（MIT）只覆盖自写文件。`skills/` 下每个技能沿用各自目录内的许可证，本文件汇总它们的来源和再分发条件。

## 总表

| 技能 | 版本 | 许可证 | 上游 | 能否公开分发 |
| --- | --- | --- | --- | --- |
| `ppt-master` | 6.9.0 | MIT | https://github.com/hugohe3/ppt-master | 可以，保留 `LICENSE` 与版权声明 |
| `html-ppt` | 0.1.0 | MIT | https://github.com/lewislulu/html-ppt-skill | 可以，保留 `LICENSE` 与版权声明 |
| `guizang-ppt` | 0.1.0 | AGPL-3.0 | https://github.com/op7418/guizang-ppt-skill | 可以，但受 AGPL 约束，见下文 |
| `ai-flavor-guard` | 0.1.0 | 未声明 | 本地自研（源出 `D:\all-in-md`） | **暂不可以**，缺许可证 |
| `dashi-ppt` | 0.4.14 | 未声明 | 本地安装包，未找到上游地址 | **不可以**，缺许可证 |

## 需要处理的两项

公开仓库前必须先处理，否则会有版权问题。`scripts/check-skills.mjs` 会把这两项打成错误。

### `ai-flavor-guard`

技能由本仓库作者维护，但全仓没有 `LICENSE` 文件。要么给这个技能目录补一份许可证（例如沿用仓库的 MIT），要么在推送到公开仓库时排除该目录。

### `dashi-ppt`

安装包里没有许可证文件，README 也没有版权声明和上游地址。拿不到授权就不要公开；可行做法是从公开仓库中删除该目录，本地保留在 `archive/`。它占本仓库体积的一半以上，删除也能让仓库瘦下来。

## AGPL-3.0 的约束

`guizang-ppt` 使用 AGPL-3.0。放进本仓库后，公开仓库里这一部分仍然受 AGPL 约束：保留许可证全文和版权声明；对它的修改也要按 AGPL 提供源码；不能把它当作 MIT 内容再分发。仓库根 `LICENSE` 与本目录的许可证互不覆盖，提交和 `README` 里已经按这个口径写明。

## 版本依据

| 技能 | 版本来源 |
| --- | --- |
| `ppt-master` | `SKILL.md` frontmatter 的 `metadata.version` |
| `dashi-ppt` | `SKILL.md` 正文与 `project/distribution-source.json` 的 `0.4.14` |
| `guizang-ppt` / `html-ppt` / `ai-flavor-guard` | 上游未声明版本，按导入顺序记为 `0.1.0`，本仓库自有版本从 `0.1.0` 起算 |

每个技能的完整来源、导入范围和恢复命令写在 `skills/<name>/PROVENANCE.md`。
