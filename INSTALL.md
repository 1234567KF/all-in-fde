# 安装

不需要 clone 整个仓库。`giget` 支持只取子目录，一条命令就能把技能落到 `.dsh/skills`，落完即可用。

## 项目级安装

装到当前项目的 `.dsh/skills`，随项目走、可以提交到项目仓库：

```powershell
npx giget@latest gh:1234567KF/all-in-fde/skills "<项目路径>\.dsh\skills"
```

macOS / Linux：

```bash
npx giget@latest gh:1234567KF/all-in-fde/skills "<项目路径>/.dsh/skills"
```

## 全局安装

所有项目都能用：

```powershell
npx giget@latest gh:1234567KF/all-in-fde/skills "$env:USERPROFILE\.dsh\skills"
```

```bash
npx giget@latest gh:1234567KF/all-in-fde/skills "$HOME/.dsh/skills"
```

## 只装一个技能

```powershell
npx giget@latest gh:1234567KF/all-in-fde/skills/token-budget "<项目路径>\.dsh\skills\token-budget"
```

## 装完验证

大多数技能是纯文本，落盘即可用。只有 `token-budget` 依赖计费工具 `dsh-cost`，它自带一份 `vendor/dsh-cost`，所以照样不用额外步骤：

```powershell
node "<项目路径>\.dsh\skills\token-budget\scripts\doctor.mjs"
```

`bin ✓`、`pricing ✓` 两行都过就说明依赖已找到。

如果想让账本跨项目共享，再把它装到用户目录（可选）：

```powershell
node "<项目路径>\.dsh\skills\token-budget\scripts\install.mjs"
```

装完 `dsh-cost` 在 `~/.dsh/dsh-cost`，账本和报表也写在那里，不进技能目录。

## 更新

重复执行同一条命令并加 `--force`：

```powershell
npx giget@latest gh:1234567KF/all-in-fde/skills "<项目路径>\.dsh\skills" --force
```

## 卸载

技能没有系统级写入，删目录即可：

```powershell
Remove-Item "<项目路径>\.dsh\skills\<技能名>" -Recurse
```

`token-budget` 如果装过 `dsh-cost`，再删 `~/.dsh/dsh-cost`。

## 想连文档一起拿

```powershell
npx giget@latest gh:1234567KF/all-in-fde "<目录>"
```

拿到的是整个仓库：`skills/`、`docs/`、`scripts/`、`bundles/`。适合改技能或看设计文档，日常安装用上面的子目录方式就够。
