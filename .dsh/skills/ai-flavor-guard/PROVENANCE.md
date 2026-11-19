# 来源说明

## 基本信息

| 项 | 内容 |
| --- | --- |
| 技能名 | `ai-flavor-guard` |
| 版本 | 0.1.1 |
| 上游 | 自研，源出 `D:\all-in-md\.qoder\skills\ai-flavor-guard` |
| 上游版本 | 未声明 |
| 导入日期 | 2026-11-18 |
| 导入来源 | `D:\all-in-fde\.dsh\skills\ai-flavor-guard`（目录联接，指向上述源目录） |

## 导入范围

保留全部 6 个文件：

- `SKILL.md`
- `AI味词汇规避规则.md`
- `references/`
- `scripts/`（含 `scan_flavor.py`）

没有依赖目录，不需要剔除。

## 与上游的差异

技能内容未改动，只新增了本仓库的旁注文件。

## 许可证

MIT，版权 2026 1234567KF，全文见目录内 `LICENSE`。可随仓库公开分发，再分发时保留许可证与版权声明。

## 恢复命令

技能是纯文本加一个 Python 脚本，不依赖安装步骤。脚本用法：

```powershell
python .dsh/skills/ai-flavor-guard/scripts/scan_flavor.py <文本.md> --profile <档ID>
```
