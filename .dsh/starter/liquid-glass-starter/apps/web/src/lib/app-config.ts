/**
 * 应用品牌配置 —— 品牌名的唯一事实源（标题 / 侧边栏 / 登录页 / 兜底标题共用）。
 *
 * 模板仓库保持 Liquid Glass 品牌；scaffold 生成项目时会按 --name 重写本文件，
 * 生成项目要改品牌只改这里（以及 index.html 的静态 title，scaffold 也会同步替换）。
 */
export const APP_NAME = "Liquid Glass"

/** 文档标题（首屏静态 title 由 index.html 提供，运行期由 main.tsx 覆盖） */
export const APP_TITLE = "Liquid Glass Design System"

/** 页脚版权文案 */
export const APP_COPYRIGHT = "© 2026 Liquid Glass"
