# 运行时同步

`.dsh/skills/` 是 DSH 加载技能的地方，`skills/` 是版本库里的副本。两边内容一样，但职责不同：一个负责运行，一个负责版本。手动改两份迟早会分叉，所以用脚本单向同步。

## 命令

```powershell
node scripts/sync-runtime.mjs                  # 仓库 -> 项目级 .dsh/skills
node scripts/sync-runtime.mjs --global         # 仓库 -> ~/.dsh/skills
node scripts/sync-runtime.mjs --target <dir>   # 指定目标目录
node scripts/sync-runtime.mjs --check          # 只比对，有差异退出码 1
node scripts/sync-runtime.mjs --dry-run        # 只列要动哪些文件
node scripts/sync-runtime.mjs --pull           # 运行时 -> 仓库
node scripts/sync-runtime.mjs --prune          # 删除只存在于运行时的多余文件
```

`--quiet` 只输出汇总，钩子和 CI 用。

## 判断文件是否需要写入

1. 目标不存在 → 写。
2. 大小不同 → 写。
3. 大小相同且 `--check`，或修改时间相差超过 2 秒 → 比 SHA256，不同才写。

其余一律跳过。一次全量比对大约一两秒。

## 不参与同步的东西

`node_modules`、`dist`、`output`、`uploads`、`screens`、`shots`、`.cache`、`__pycache__`、`.venv`、`venv`、`tmp`。

这些是依赖和运行产物，仓库里本来就没有，同步时也不碰运行时的。

## 目录联接

运行时目录如果是目录联接或符号链接，脚本直接跳过并打印出来，不往里写。当前 `ai-flavor-guard` 就是这种情况：`.dsh/skills/ai-flavor-guard` 指向 `D:\all-in-md\.qoder\skills\ai-flavor-guard`，写进去等于改另一个仓库。

要让这类技能也纳入同步，先把链接换成实体目录，再跑同步。

## 自动同步

装钩子：

```powershell
git config core.hooksPath .githooks
```

之后每次提交成功，`post-commit` 会跑一次 `node scripts/sync-runtime.mjs --quiet`。同步失败了只打印提示，不影响提交本身。

## 反向同步的注意点

`--pull` 会把运行时的新文件、改动一起带回 `skills/`。带回来的内容会出现在 `git status` 里，提交前照常过一遍 `check-skills.mjs` 和 `sync-index.mjs`。

## 只存在于运行时的技能

脚本会统计它们，但不会自动删除目录——删除整个技能目录不可逆，看清列出来的名字再用手工处理，或加 `--prune` 只删多余文件。
