# 第三方技能与许可声明

本仓库根目录的 `LICENSE`（MIT）只覆盖自写文件。`.dsh/skills/` 下每个技能沿用各自目录内的许可证，本文件汇总它们的来源和再分发条件。

## 随仓库分发的技能

| 技能 | 版本 | 许可证 | 上游 | 能否公开分发 |
| --- | --- | --- | --- | --- |
| `all-in-fde` | 0.1.0 | MIT | 自研 | 可以 |
| `token-budget` | 0.2.0 | MIT | 自研 | 可以 |
| `ponytail` | 5.3.3 | MIT | https://github.com/DietrichGebert/ponytail | 可以，保留 `LICENSE` 与版权声明 |
| `rea-video` | 0.1.0 | Apache-2.0 | https://github.com/JuneYaooo/rea-video | 可以，保留 `LICENSE` 与版权声明 |
| `ai-flavor-guard` | 0.1.0 | 未声明 | 本地自研 | **暂不可以**，缺许可证 |

## 需要处理的一项

**仓库已经公开，`ai-flavor-guard` 目前处于公开可见状态。** 技能由本仓库作者维护，但目录里没有 `LICENSE`。两条路：补一份许可证（例如沿用仓库的 MIT），或从公开仓库删除该目录。

## 已移出分发的技能

`dashi-ppt`、`guizang-ppt`、`html-ppt`、`ppt-master` 因为体积过大（合计约 170 MB）已从 `.dsh/skills/` 移出，本机留档在 `archive/skills/`，不进版本库。它们仍存在于 git 历史（`v0.4.0` 及更早）里。

| 技能 | 许可证 | 处理 |
| --- | --- | --- |
| `ppt-master` 6.9.0 | MIT | 需要时按上游重新安装 |
| `html-ppt` 0.1.0 | MIT | 需要时按上游重新安装 |
| `guizang-ppt` 0.1.0 | AGPL-3.0 | 需要时按上游重新安装，**保持 AGPL 独立授权**，不能并入仓库 MIT |
| `dashi-ppt` 0.4.14 | 未声明 | **无授权**，不应再分发；只保留在本机与 git 历史中 |

`guizang-ppt` 这部分的约束：若重新引入，要保留许可证全文与版权声明；对它的修改按 AGPL 提供源码；不能当作 MIT 内容再分发。

若要从公开历史里彻底抹掉 `dashi-ppt`，需要用 `git filter-repo` 重写历史；在此之前，之前推上去的副本仍可能留在 GitHub 缓存和已有 fork 里，删除当前提交只是止损，不是彻底抹除。

## 版本依据

| 技能 | 版本来源 |
| --- | --- |
| `ppt-master` | `SKILL.md` frontmatter 的 `metadata.version` |
| `dashi-ppt` | `SKILL.md` 正文与 `project/distribution-source.json` 的 `0.4.14` |
| `guizang-ppt`、`html-ppt`、`ai-flavor-guard` | 上游未声明版本，按导入顺序记为 `0.1.0`，本仓库自有版本从 `0.1.0` 起算 |

移出分发的三个技能，元数据保留在 `docs/skills/`，完整来源说明仍可用 `git show v0.4.0:.dsh/skills/<name>/PROVENANCE.md` 取出。
