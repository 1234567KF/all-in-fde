import FullPageLoader from "@workspace/ui/components/shared/FullPageLoader"
import PageSkeleton from "@workspace/ui/components/shared/PageSkeleton"
import { refreshAccessToken } from "@workspace/web-core/lib/api"
import ProtectedRoute from "@workspace/web-core/router/ProtectedRoute"
import { useAuthStore } from "@workspace/web-core/stores/auth"
import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"

import RouteErrorBoundary from "@/components/layout/RouteErrorBoundary"
import SidebarLayout from "@/layouts/SidebarLayout"
import LoginPage from "@/pages/LoginPage"

// DashboardPage 属于演示（demo）特性清单里的待删除页面，但演示剥离时会被 replaceFiles
// 替换为精简欢迎页，根路由 / 与 /dashboard 仍挂载它 —— 因此懒加载声明必须留在区块外。
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))
// #region feature:audit-log
const AuditLogPage = lazy(() => import("@/pages/audit-log/AuditLogPage"))
// #endregion feature:audit-log
// #region feature:demo
const ComponentsOverviewPage = lazy(
  () => import("@/pages/ComponentsOverviewPage")
)
// #region feature:notification
const NotificationsPage = lazy(() => import("@/pages/NotificationsPage"))
// #endregion feature:notification
const FoundationsPage = lazy(() => import("@/pages/FoundationsPage"))
const FormsPage = lazy(() => import("@/pages/FormsPage"))
const DataPage = lazy(() => import("@/pages/DataPage"))
const OverlaysPage = lazy(() => import("@/pages/OverlaysPage"))
const SystemSettingsPage = lazy(() => import("@/pages/SystemSettingsPage"))
const VirtualTableDemoPage = lazy(() => import("@/pages/VirtualTableDemoPage"))
const ResultPage = lazy(() => import("@/pages/ResultPage"))
// #endregion feature:demo
const ProfileSettingsPage = lazy(() => import("@/pages/ProfileSettingsPage"))
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"))
const ForbiddenPage = lazy(() => import("@/pages/ForbiddenPage"))
const ServerErrorPage = lazy(() => import("@/pages/ServerErrorPage"))

// [gen:module:app-lazy-imports] 由 bun run gen:module 追加业务模块页面懒加载（勿手改本行）

export default function App() {
  const [isAuthReady, setIsAuthReady] = useState(false)
  const attemptedRef = useRef(false)

  useEffect(() => {
    const init = async () => {
      const { accessToken, refreshToken } = useAuthStore.getState()

      if (accessToken || !refreshToken) {
        // 已有 token 或无 refreshToken，无需刷新
        setIsAuthReady(true)
        return
      }

      if (attemptedRef.current) return
      attemptedRef.current = true

      try {
        await refreshAccessToken()
      } catch {
        // 刷新失败，清空状态（refreshAccessToken 内部已处理）
      } finally {
        setIsAuthReady(true)
      }
    }
    init()
  }, [])

  if (!isAuthReady) {
    return <FullPageLoader message="正在恢复登录状态..." />
  }

  return (
    <>
      <RouteErrorBoundary>
        <Routes>
          {/* 登录页：无侧边栏，全屏 */}
          <Route path="/login" element={<LoginPage />} />

          {/* 根路径重定向到仪表盘 */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* 认证守卫 → 有侧边栏的页面 */}
          <Route element={<ProtectedRoute />}>
            <Route element={<SidebarLayout />}>
              <Route
                path="/dashboard"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <DashboardPage />
                  </Suspense>
                }
              />
              <Route
                path="/settings"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ProfileSettingsPage />
                  </Suspense>
                }
              />
              {/* #region feature:demo */}
              <Route
                path="/components"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ComponentsOverviewPage />
                  </Suspense>
                }
              />
              <Route
                path="/components/foundations"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <FoundationsPage />
                  </Suspense>
                }
              />
              <Route
                path="/components/forms"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <FormsPage />
                  </Suspense>
                }
              />
              <Route
                path="/components/data"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <DataPage />
                  </Suspense>
                }
              />
              <Route
                path="/components/overlays"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <OverlaysPage />
                  </Suspense>
                }
              />
              {/* #region feature:notification */}
              <Route
                path="/components/notifications"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <NotificationsPage />
                  </Suspense>
                }
              />
              {/* #endregion feature:notification */}
              <Route
                path="/virtual-table"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <VirtualTableDemoPage />
                  </Suspense>
                }
              />
              <Route
                path="/404-demo"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <NotFoundPage />
                  </Suspense>
                }
              />
              <Route
                path="/403-demo"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ForbiddenPage />
                  </Suspense>
                }
              />
              <Route
                path="/500-demo"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ServerErrorPage />
                  </Suspense>
                }
              />
              <Route
                path="/result-demo"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <ResultPage />
                  </Suspense>
                }
              />
              <Route
                path="/system-settings"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <SystemSettingsPage />
                  </Suspense>
                }
              />
              {/* #endregion feature:demo */}
              {/* #region feature:audit-log */}
              <Route
                path="/audit-log"
                element={
                  <Suspense fallback={<PageSkeleton />}>
                    <AuditLogPage />
                  </Suspense>
                }
              />
              {/* #endregion feature:audit-log */}
              {/* [gen:module:app-routes] 由 bun run gen:module 追加业务模块路由（勿手改本行） */}
            </Route>
          </Route>

          <Route
            path="/403"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <ForbiddenPage />
              </Suspense>
            }
          />
          <Route
            path="/500"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <ServerErrorPage />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <NotFoundPage />
              </Suspense>
            }
          />
        </Routes>
      </RouteErrorBoundary>
      <Toaster richColors position="top-right" />
    </>
  )
}
