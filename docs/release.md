# 发布清单

现在不推送远端。等准备公开时，按下面顺序过一遍。

## 1 许可证

- [ ] `ai-flavor-guard` 补 `LICENSE`，或在公开前删除该目录。
- [ ] `dashi-ppt` 拿到授权后保留许可证文件；拿不到就从仓库删除，本地留档在 `archive/`。
- [ ] `guizang-ppt` 保留 AGPL-3.0 全文与版权声明，`NOTICE.md` 已写明约束。
- [ ] `ppt-master`、`html-ppt` 保留各自 `LICENSE` 与版权头。
- [ ] 仓库根 `LICENSE` 与 `NOTICE.md` 的口径一致。

## 2 体积

GitHub 单文件上限 100 MB，仓库建议 1 GB 以内。当前快照约 115 MB，主要来自 `ppt-master` 的模板和 `dashi-ppt` 的 `src/`。

- [ ] `git count-objects -vH` 看实际体积。
- [ ] 单个文件超过 50 MB 的，改用 release 附件或 Git LFS。
- [ ] 决定 `dashi-ppt/project/dist`（约 19 MB 构建产物）留不留；已写在 `.gitignore`，默认不进版本库。

## 3 敏感信息

- [ ] 全仓搜 `password`、`token`、`secret`、`api_key`、`192.168.`、`10.`、`localhost:` 等内网地址。
- [ ] `node scripts/check-public-artifacts.mjs` 退出 0：对外产物（技能、模板、生成器）无内网地址、本地路径、内部项目名。
- [ ] 检查 `META.json` 的 `importedFrom` 是否包含本机用户名和绝对路径；公开前改写成相对描述。
- [ ] `.env`、密钥、证书类文件确认没有入库。

## 4 仓库设置

- [ ] 远端仓库名与仓库内容对得上（当前目录名 `all-in-fde` 是早期工作区名，建议改成 `skills` 之类的名字）。
- [ ] `git branch -M main`，把默认分支从 `master` 改过来。
- [ ] 配远端：`git remote add origin <url>`。
- [ ] 首推 `git push -u origin main`，再推标签 `git push --tags`。
- [ ] GitHub 仓库描述、Topics、README 首屏再确认一遍。

## 5 CI 与保护

- [ ] `.github/workflows/validate.yml` 在仓库推上去后能跑通。
- [ ] 打开分支保护，要求 `validate-skills` 通过才能合并。
- [ ] 确认 `.dsh/skills/**` 的 `linguist-vendored` 标记生效，语言统计不被第三方技能占满。

## 6 发布前最后一遍

```powershell
node scripts/sync-index.mjs
node scripts/check-skills.mjs
git status --short
git log --oneline --decorate -5
git tag -n
```

- [ ] 工作区干净。
- [ ] `check-skills.mjs` 退出码为 0。
- [ ] 标签与 `CHANGELOG.md` 对得上。
