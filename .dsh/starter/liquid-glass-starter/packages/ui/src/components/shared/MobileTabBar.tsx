/**
 * MobileTabBar — 移动端底部一级导航（原生 App 范式）
 *
 * <md 时常驻屏幕底部：调用方传入已按权限过滤的高频入口 +「菜单」格唤起全量抽屉。
 * 桌面端不渲染（结构性分叉走 useIsMobile 单树原则）。
 * items 由调用方派生（如 getMobileTabItems），本组件只负责呈现与唤起抽屉。
 */
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"
import { LayoutGrid, type LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { useSidebar } from "../ui/sidebar"

export interface MobileTabItem {
  title: string
  path: string
  icon: LucideIcon
}

interface MobileTabBarProps {
  items: MobileTabItem[]
  menuLabel?: string
}

const TAB_ITEM_CLS =
  // touch-manipulation 关闭双击缩放判定延迟，保证 Tab 点按即时响应，active:scale-95 提供微触觉缩放反馈
  "flex h-[var(--tabbar-height)] touch-manipulation flex-col items-center justify-center gap-0.5 transition-all duration-150 active:scale-95 select-none"

export function MobileTabBar({ items, menuLabel = "菜单" }: MobileTabBarProps) {
  const isMobile = useIsMobile()
  const location = useLocation()
  const { openMobile, setOpenMobile } = useSidebar()

  // 移动端恒渲染：items 为空（权限异常）时仍保留「菜单」保底入口，避免导航死路
  if (!isMobile) return null

  return (
    <nav
      aria-label="底部导航"
      // z 高于 Sheet（z-50）：抽屉打开时 TabBar 仍可见可点（Tab 一级、菜单二级）
      className="fixed inset-x-0 bottom-0 z-[60] grid"
      style={{
        gridTemplateColumns: `repeat(${items.length + 1}, 1fr)`,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--lg-surface-glass)",
        backdropFilter: "blur(var(--glass-blur-heavy))",
        WebkitBackdropFilter: "blur(var(--glass-blur-heavy))",
        borderTop: "1px solid var(--lg-border-subtle)",
      }}
    >
      {items.map((item) => {
        const isActive = location.pathname === item.path && !openMobile
        return (
          <Link
            key={item.path}
            to={item.path}
            viewTransition
            aria-current={isActive ? "page" : undefined}
            // 抽屉开着时点其他 Tab 直接切页并收起抽屉
            onClick={() => setOpenMobile(false)}
            className={TAB_ITEM_CLS}
            style={{
              color: isActive
                ? "var(--lg-primary-light)"
                : "var(--lg-text-secondary)",
            }}
          >
            <item.icon
              className="size-5"
              style={
                isActive
                  ? { filter: "drop-shadow(var(--shadow-glow-primary))" }
                  : undefined
              }
            />
            <span className="text-[11px] leading-none font-medium">
              {item.title}
            </span>
          </Link>
        )
      })}
      <button
        type="button"
        onClick={() => setOpenMobile(!openMobile)}
        aria-expanded={openMobile}
        className={cn(TAB_ITEM_CLS, "cursor-pointer")}
        style={{
          color: openMobile
            ? "var(--lg-primary-light)"
            : "var(--lg-text-secondary)",
        }}
      >
        <LayoutGrid
          className="size-5"
          style={
            openMobile
              ? { filter: "drop-shadow(var(--shadow-glow-primary))" }
              : undefined
          }
        />
        <span className="text-[11px] leading-none font-medium">
          {menuLabel}
        </span>
      </button>
    </nav>
  )
}
