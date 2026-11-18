# .tmp

本目录存放临时产物：下载验证、截图、渲染中间结果、测试输出。整个目录可以随时清空，不影响技能本身。

## 规则

- 新脚本写临时文件时，路径统一落到 `.tmp/` 下，不要写仓库根或技能目录。
- 这里的内容不进版本库（`.gitignore` 已排除，只保留本说明）。
- 清理：

```powershell
node scripts/clean-tmp.mjs                    # 先看有哪些、占多大
node scripts/clean-tmp.mjs --all              # 全部清掉，保留本文件
node scripts/clean-tmp.mjs --older-than 7     # 只清 7 天前的
node scripts/clean-tmp.mjs --legacy --all     # 连根目录的旧式 .tmp-* 一起清
```

定时清理（Windows 计划任务）示例：

```powershell
schtasks /create /tn "all-in-fde-clean-tmp" /sc daily /st 03:00 /tr "node D:\all-in-fde\scripts\clean-tmp.mjs --all --legacy"
```
