/**
 * 端作用域：把「同一套代码跑在多个 URL 前缀下」的两处差异收在一起。
 *
 * 1. 浏览器存储键按端隔离——同一浏览器里企业端登录不影响运营端。
 *    默认端沿用历史键名，存量会话不需要迁移；其他端加 `:<id>` 后缀。
 *    主题偏好（theme / theme-color）刻意不走这里，跨端共享同一套外观。
 * 2. 整页跳转必须带 base 前缀，否则非默认端会跳到默认端的登录页。
 *    组件内的路由跳转用 react-router 的 navigate，它已经知道 basename。
 */
const DEFAULT_APP_ID = "web"

export function scopedStorageKey(key: string): string {
  const appId = import.meta.env.VITE_APP_ID
  return !appId || appId === DEFAULT_APP_ID ? key : `${key}:${appId}`
}

/** 登录页的整页跳转地址（BASE_URL 由 vite base 注入，形如 "/" 或 "/portal/"） */
export function loginUrl(): string {
  return `${import.meta.env.BASE_URL}login`
}
