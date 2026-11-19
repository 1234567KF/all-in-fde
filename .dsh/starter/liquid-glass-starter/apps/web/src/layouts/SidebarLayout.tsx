import { MobileTabBar } from "@workspace/ui/components/shared/MobileTabBar"
import { ModeToggle } from "@workspace/ui/components/shared/mode-toggle"
import ResultCard from "@workspace/ui/components/shared/ResultCard"
import { Button } from "@workspace/ui/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@workspace/ui/components/ui/sidebar"
import { TooltipProvider } from "@workspace/ui/components/ui/tooltip"
import { usePermission } from "@workspace/web-core/hooks/usePermission"
import { useAuthStore } from "@workspace/web-core/stores/auth"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"
import type { PermissionCode } from "shared"

import RouteErrorBoundary from "@/components/layout/RouteErrorBoundary"
import { TopBar } from "@/components/layout/TopBar"
import { CommandPalette } from "@/components/shared/CommandPalette"
import { APP_NAME } from "@/lib/app-config"
import {
  filterMenuGroups,
  getMobileTabItems,
  type MenuGroup,
  menuGroups,
} from "@/lib/menu-config"
import { useLayoutStore } from "@/stores/layoutStore"

function SidebarMenuContent({ groups }: { groups: MenuGroup[] }) {
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()

  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <SidebarContent>
      {groups.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--lg-text-muted)",
            }}
          >
            {group.label}
          </SidebarGroupLabel>
          <SidebarMenu>
            {group.items.map((item) => {
              const isActive =
                item.path === "/components"
                  ? location.pathname === "/components"
                  : item.path === "/dashboard"
                    ? location.pathname === "/dashboard"
                    : location.pathname.startsWith(item.path)
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.title}
                  >
                    <Link
                      to={item.path}
                      viewTransition
                      onClick={handleLinkClick}
                    >
                      <item.icon
                        className="size-5"
                        style={
                          isActive
                            ? {
                                filter:
                                  "drop-shadow(0 0 8px var(--lg-primary-glow))",
                              }
                            : undefined
                        }
                      />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </SidebarContent>
  )
}

export default function SidebarLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { can } = usePermission()
  const [searchOpen, setSearchOpen] = useState(false)
  const [isMac] = useState(() =>
    /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent)
  )
  const layoutWidth = useLayoutStore((s) => s.layoutWidth)

  const maxWidth =
    layoutWidth === "standard"
      ? 1280
      : layoutWidth === "wide"
        ? 1600
        : undefined

  const visibleGroups = useMemo(() => filterMenuGroups(menuGroups, can), [can])
  const mobileTabs = useMemo(
    () => getMobileTabItems(visibleGroups),
    [visibleGroups]
  )

  // iOS Safari 下 SPA 切页不重置滚动，内滚壳层会停留上页深度；切页即回顶
  const insetRef = useRef<HTMLElement>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    insetRef.current?.scrollTo(0, 0)
  }, [location.pathname])

  // ⌘K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  // 体验层准入：无权限时不渲染业务出口。接口鉴权仍由后端 requirePermission 负责。
  // 准入码由 web-apps.json 经 vite define 注入，克隆出的新端自动继承，无需改端内代码。
  // 必须放在全部 hook 之后——提前 return 会让后续 hook 数量随权限变化，违反 hooks 规则。
  const accessPermission = import.meta.env.VITE_APP_ACCESS_PERMISSION
  if (accessPermission && !can(accessPermission as PermissionCode)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <ResultCard
          type="warning"
          title="无权访问本系统"
          description="当前账号未被授予本端的准入权限，请联系管理员分配后重新登录。"
          actions={
            <Button
              variant="outline"
              onClick={() => {
                clearAuth()
                navigate("/login", { replace: true })
              }}
            >
              退出登录
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <TooltipProvider>
      {/* max-md 固定视口高 + 内滚：避免页面滚动收缩导致底部 TabBar 首次点按被浏览器手势吞掉 */}
      <SidebarProvider className="max-md:h-dvh max-md:overflow-hidden">
        <Sidebar className="border-r border-[var(--lg-border-subtle)] bg-[var(--lg-surface-elevated)] backdrop-blur-xl">
          {/* Brand */}
          <SidebarHeader className="px-6 py-8 max-md:px-3 max-md:pt-1 max-md:pb-2">
            <div className="flex items-center gap-4 pl-1">
              <div
                className="flex size-9 items-center justify-center rounded-lg text-lg font-bold"
                style={{
                  background: "var(--lg-primary-dim)",
                  color: "var(--lg-primary-light)",
                  fontFamily: "var(--font-heading)",
                }}
              >
                G
              </div>
              <div>
                <h1
                  className="text-xl leading-tight font-bold tracking-[-0.01em]"
                  style={{
                    fontFamily: "var(--font-heading)",
                    color: "var(--lg-primary-light)",
                  }}
                >
                  {APP_NAME}
                </h1>
                <p
                  className="mt-0.5 text-[11px] font-medium tracking-[0.05em] uppercase opacity-70"
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--lg-text-secondary)",
                  }}
                >
                  Design System
                </p>
              </div>
            </div>
          </SidebarHeader>

          {/* Navigation */}
          <SidebarMenuContent groups={visibleGroups} />

          {/* Footer */}
          <SidebarFooter className="border-t border-[var(--lg-border-subtle)] p-4 max-md:hidden">
            <div className="flex items-center justify-between px-2">
              <span className="font-mono text-xs text-outline">v0.1.0</span>
              <ModeToggle />
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Main Area */}
        <SidebarInset
          ref={insetRef}
          className="min-w-0 bg-transparent max-md:min-h-0 max-md:overflow-y-auto max-md:overscroll-contain"
        >
          {/* TopBar */}
          <TopBar onSearchOpen={() => setSearchOpen(true)} isMac={isMac} />

          {/* Command Dialog */}
          <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

          {/* Page Content */}
          <div
            // basis-auto：内滚壳层下 flex-1 的 basis-0 会让内容溢出而非撑开滚动高度
            className="mx-auto w-full min-w-0 flex-1 basis-auto"
            style={{
              padding: "var(--spacing-page)",
              maxWidth,
            }}
          >
            <RouteErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </RouteErrorBoundary>
          </div>

          {/* 移动端底部 Tab 占位（fixed Tab 不参与布局流，防止内容被遮挡）；
              shrink-0：固定高度滚动壳层下 flex 子项会被压缩致垫底失效 */}
          <div
            aria-hidden
            className="shrink-0 md:hidden"
            style={{
              height:
                "calc(var(--tabbar-height) + env(safe-area-inset-bottom))",
            }}
          />
        </SidebarInset>

        {/* 移动端底部一级导航（桌面不渲染） */}
        <MobileTabBar items={mobileTabs} />
      </SidebarProvider>
    </TooltipProvider>
  )
}
