import { extractErrorMessage } from "@workspace/web-core/lib/errors"
import { showInfo } from "@workspace/web-core/lib/toast"
import { useAuthStore } from "@workspace/web-core/stores/auth"
import { useNavigate } from "react-router-dom"

import { NotificationCenter } from "@/components/shared/NotificationCenter"
import {
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/queries/useNotifications"
import { useNotificationStream } from "@/hooks/queries/useNotificationStream"

/**
 * 顶栏消息中心插槽 —— 消息通知特性（可选特性）在宿主布局中的唯一边界。
 *
 * 通知域的状态（列表 / 未读数 / mutations / SSE 订阅）与 9 项 props 组装整体内聚在
 * 本文件，TopBar 只负责挂载本组件。剥离通知特性时删除本文件与 TopBar 中的区块即可，
 * TopBar 不再感知任何通知领域逻辑；未读数轮询与 SSE 事件引发的重渲染也收敛到本子树，
 * 搜索框 / 主题面板 / 用户菜单不会跟随重跑。
 *
 * - enabled 绑定登录态：即使将来 TopBar 被复用到公开布局也不会发未认证请求。
 * - 列表 / 未读数走 Query hooks，写操作走 mutations（乐观更新 + 失效），
 *   SSE 事件到达时自动刷新列表与角标。
 */
export function TopBarNotificationSlot() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((state) => state.accessToken)
  const isAuthenticated = Boolean(accessToken)

  const {
    data: notificationPage,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useNotifications({ limit: 20, enabled: isAuthenticated })
  const { data: unreadCount = 0 } = useUnreadCount({ enabled: isAuthenticated })
  const { mutate: markRead } = useMarkRead()
  const { mutate: markAllRead } = useMarkAllRead()
  const { mutate: removeNotification } = useDeleteNotification()
  useNotificationStream()

  return (
    <NotificationCenter
      notifications={notificationPage?.items ?? []}
      unreadCount={unreadCount}
      loading={isLoading || isFetching}
      error={isError ? extractErrorMessage(error) : null}
      onMarkRead={(notification) => markRead(notification.id)}
      onMarkAllRead={() => markAllRead()}
      onDelete={(notification) => removeNotification(notification.id)}
      onRetry={() => void refetch()}
      onItemClick={(notification) => {
        if (notification.href) {
          navigate(notification.href, { viewTransition: true })
        } else {
          showInfo("该消息没有关联页面")
        }
      }}
    />
  )
}
