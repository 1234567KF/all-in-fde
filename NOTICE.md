# 第三方技能与许可声明

本仓库根目录的 `LICENSE`（MIT）只覆盖自写文件。`.dsh/skills/` 下每个技能沿用各自目录内的许可证，本文件汇总它们的来源和再分发条件。

## 随仓库分发的技能

| 技能 | 版本 | 许可证 | 上游 | 能否公开分发 |
| --- | --- | --- | --- | --- |
| `all-in-fde` | 0.2.1 | MIT | 自研 | 可以 |
| `token-budget` | 0.2.0 | MIT | 自研 | 可以 |
| `ai-flavor-guard` | 0.1.1 | MIT | 自研 | 可以，保留 `LICENSE` 与版权声明 |
| `ponytail` | 5.3.3 | MIT | https://github.com/DietrichGebert/ponytail | 可以，保留 `LICENSE` 与版权声明 |
| `rea-video` | 0.1.0 | Apache-2.0 | https://github.com/JuneYaooo/rea-video | 可以，保留 `LICENSE` 与版权声明 |

5 个随包技能全部有明确许可证，公开分发没有阻塞项。

## 已移出分发的技能

`dashi-ppt`、`guizang-ppt`、`html-ppt`、`ppt-master` 因为体积过大（合计约 170 MB）已从 `.dsh/skills/` 移出，本机留档在 `archive/skills/`，不进版本库。

| 技能 | 许可证 | 处理 |
| --- | --- | --- |
| `ppt-master` 6.9.0 | MIT | 需要时按上游重新安装；仍在 git 历史中 |
| `html-ppt` 0.1.0 | MIT | 需要时按上游重新安装；仍在 git 历史中 |
| `guizang-ppt` 0.1.0 | AGPL-3.0 | 需要时按上游重新安装，**保持 AGPL 独立授权**；仍在 git 历史中 |
| `dashi-ppt` 0.4.14 | 未声明 | **无授权**；已于 2026-11-19 用 `git filter-repo` 从全部历史中删除 |

`guizang-ppt` 这部分的约束：若重新引入，要保留许可证全文与版权声明；对它的修改按 AGPL 提供源码；不能当作 MIT 内容再分发。

## 历史重写说明

2026-11-19 为清除 `dashi-ppt`，用 `git filter-repo` 重写了全部提交，所有提交哈希与标签都已改变。此前 clone 过本仓库的人需要重新 clone，不能靠 `git pull` 或 `git rebase` 跟上。

GitHub 侧的限制：重写后旧提交不再被任何分支或标签引用，但可能在一段时间内仍可从 GitHub 的缓存或已有 fork 中访问。要彻底清除缓存需要联系 GitHub Support；已经存在的 fork 不受影响。

## 版本依据

| 技能 | 版本来源 |
| --- | --- |
| `ppt-master` | `SKILL.md` frontmatter 的 `metadata.version` |
| `dashi-ppt` | `SKILL.md` 正文与 `project/distribution-source.json` 的 `0.4.14` |
| `guizang-ppt`、`html-ppt` | 上游未声明版本，按导入顺序记为 `0.1.0` |

移出分发的三个技能，元数据保留在 `docs/skills/`，完整来源说明仍可用 `git show v0.4.0:.dsh/skills/<name>/PROVENANCE.md` 取出。
