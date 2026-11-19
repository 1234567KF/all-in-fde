/**
 * MobileTabBar 单元测试
 * 覆盖：桌面不渲染、移动端渲染 items + 菜单保底、空 items 保底、
 * 菜单格唤起抽屉（aria-expanded 翻转）、当前路径 aria-current
 */
import { fireEvent, render, screen } from "@testing-library/react"
import { MobileTabBar } from "@workspace/ui/components/shared/MobileTabBar"
import { SidebarProvider } from "@workspace/ui/components/ui/sidebar"
import { LayoutDashboard, Settings } from "lucide-react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

// 可控的 useIsMobile mock（默认桌面端，移动分支用例内改为 true）
const { isMobileMock } = vi.hoisted(() => ({
  isMobileMock: vi.fn(() => false),
}))
vi.mock("@workspace/ui/hooks/use-mobile", () => ({ useIsMobile: isMobileMock }))

afterEach(() => {
  isMobileMock.mockReturnValue(false)
})

const items = [
  { title: "仪表盘", path: "/dashboard", icon: LayoutDashboard },
  { title: "个人设置", path: "/settings", icon: Settings },
]

function renderBar(initialPath = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SidebarProvider>
        <MobileTabBar items={items} />
      </SidebarProvider>
    </MemoryRouter>
  )
}

describe("MobileTabBar", () => {
  it("桌面端不渲染", () => {
    renderBar()
    expect(screen.queryByLabelText("底部导航")).not.toBeInTheDocument()
  })

  it("移动端渲染 items 与菜单保底格", () => {
    isMobileMock.mockReturnValue(true)
    renderBar()
    expect(screen.getByLabelText("底部导航")).toBeInTheDocument()
    expect(screen.getByText("仪表盘")).toBeInTheDocument()
    expect(screen.getByText("个人设置")).toBeInTheDocument()
    expect(screen.getByText("菜单")).toBeInTheDocument()
  })

  it("items 为空仍保留菜单保底入口", () => {
    isMobileMock.mockReturnValue(true)
    render(
      <MemoryRouter>
        <SidebarProvider>
          <MobileTabBar items={[]} />
        </SidebarProvider>
      </MemoryRouter>
    )
    expect(screen.getByText("菜单")).toBeInTheDocument()
  })

  it("点菜单格唤起抽屉（aria-expanded 翻转）", () => {
    isMobileMock.mockReturnValue(true)
    renderBar()
    const menu = screen.getByRole("button", { name: "菜单" })
    expect(menu).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(menu)
    expect(menu).toHaveAttribute("aria-expanded", "true")
  })

  it("当前路径 Tab 标记 aria-current，其余不标记", () => {
    isMobileMock.mockReturnValue(true)
    renderBar("/settings")
    expect(screen.getByText("个人设置").closest("a")).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByText("仪表盘").closest("a")).not.toHaveAttribute(
      "aria-current"
    )
  })
})
