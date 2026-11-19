/**
 * 端冒烟测试：路由守卫、404 兜底、已登录渲染本端布局、端准入拦截。
 *
 * 本文件随 `add:web` 克隆进入每个新端，所以断言只挑「模板仓库与生成项目都成立」
 * 的锚点（登录按钮文案 / 404 标题 / 侧边栏品牌名），不断言 DashboardPage 内容
 * ——它在模板里是演示页、在生成项目里是精简欢迎页。
 *
 * 准入码由 web-apps.json 经 vite define 注入，测试用 vi.stubEnv 覆盖（Vitest 对
 * import.meta.env.* 是运行时处理，stubEnv 能盖住 define 的字面量，已实证）。
 */
import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { ThemeProvider } from "@workspace/ui/components/providers/theme-provider"
import { queryClient } from "@workspace/web-core/lib/query"
import { useAuthStore } from "@workspace/web-core/stores/auth"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// 只 mock 内核层（api 实例 + toast）与全局 fetch：这两处每个端必有，且与业务无关。
// 刻意不 mock `@/services/*`——init 剥掉站内信的项目里那些模块不存在，克隆来的
// 测试会因 vi.mock 解析不到路径而炸。请求一律 reject，让 query 落到 error/空态。
vi.mock("@workspace/web-core/lib/api", () => {
  const offline = () => Promise.reject(new Error("smoke test: no network"))
  const instance = {
    get: offline,
    post: offline,
    put: offline,
    patch: offline,
    delete: offline,
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  }
  return { api: instance, default: instance, refreshAccessToken: offline }
})

vi.mock("@workspace/web-core/lib/toast", () => ({
  showError: vi.fn(),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}))

import { APP_NAME } from "@/lib/app-config"

import App from "./App"

const ACCESS_CODE = "app:smoke-test"

// Provider 栈与 main.tsx 一致：少了 ThemeProvider，布局里的 ModeToggle 会抛错
function renderApp(initialPath: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ThemeProvider defaultTheme="system">
          <App />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function signIn(permissions: string[]) {
  useAuthStore.setState({
    accessToken: "test-token",
    // refreshToken 留空，避免 App 的会话恢复 effect 发真实请求
    refreshToken: null,
    user: { email: "tester", name: "测试员", role: "user", permissions },
  })
}

function resetAuth() {
  useAuthStore.setState({
    accessToken: null,
    refreshToken: null,
    user: null,
  })
}

describe("端路由与准入冒烟", () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetAuth()
    // SSE 走 fetch 而非 axios，必须单独堵掉；retry 关掉避免退避定时器拖尾
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("smoke test: no network")))
    )
    queryClient.setDefaultOptions({ queries: { retry: false } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    sessionStorage.clear()
    resetAuth()
    queryClient.clear()
  })

  it("未登录访问受保护路由 → 跳登录页", async () => {
    renderApp("/dashboard")
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "进入系统" })
      ).toBeInTheDocument()
    })
  })

  it("未登录访问未知路由 → 404 页", async () => {
    renderApp("/no-such-route")
    await waitFor(() => {
      expect(
        screen.getByText("哦豁！你来到了未知的虚无之境")
      ).toBeInTheDocument()
    })
  })

  it("已登录且本端不设准入 → 渲染侧边栏布局", async () => {
    vi.stubEnv("VITE_APP_ACCESS_PERMISSION", "")
    signIn([])
    renderApp("/dashboard")
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: APP_NAME })
      ).toBeInTheDocument()
    })
    expect(screen.queryByText("无权访问本系统")).not.toBeInTheDocument()
  })

  it("本端设准入但账号未持有 → 拦截，不渲染业务出口", async () => {
    vi.stubEnv("VITE_APP_ACCESS_PERMISSION", ACCESS_CODE)
    signIn([])
    renderApp("/dashboard")
    await waitFor(() => {
      expect(screen.getByText("无权访问本系统")).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("heading", { name: APP_NAME })
    ).not.toBeInTheDocument()
  })

  it("旧会话缺 permissions 字段 → fail-closed 同样拦截", async () => {
    vi.stubEnv("VITE_APP_ACCESS_PERMISSION", ACCESS_CODE)
    useAuthStore.setState({
      accessToken: "test-token",
      refreshToken: null,
      user: { email: "tester", name: "测试员", role: "user" },
    })
    renderApp("/dashboard")
    await waitFor(() => {
      expect(screen.getByText("无权访问本系统")).toBeInTheDocument()
    })
  })

  it("本端设准入且账号持有 → 正常渲染布局", async () => {
    vi.stubEnv("VITE_APP_ACCESS_PERMISSION", ACCESS_CODE)
    signIn([ACCESS_CODE])
    renderApp("/dashboard")
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: APP_NAME })
      ).toBeInTheDocument()
    })
    expect(screen.queryByText("无权访问本系统")).not.toBeInTheDocument()
  })
})
