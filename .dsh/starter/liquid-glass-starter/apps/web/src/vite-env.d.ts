/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_TITLE: string
  readonly VITE_AUTH_REFRESH_PATH?: string
  /** 构建时间戳，由 CI / 构建脚本注入，缺失时页面回退为“未注入” */
  readonly VITE_BUILD_TIME?: string
  /** 端 id，由 vite.config.ts 从 web-apps.json 注入；缺失时按默认端处理 */
  readonly VITE_APP_ID?: string
  /** 端准入权限码，同源注入；空串 = 本端不设准入拦截 */
  readonly VITE_APP_ACCESS_PERMISSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
