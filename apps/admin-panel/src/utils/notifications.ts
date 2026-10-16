// Shared by the header bell and the /notifications inbox, so both collapse repeats and read
// severity the same way.

export interface AdminNotification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  // 'critical' | 'warning' | 'info' from the API; NULL/absent on legacy rows -- always read it
  // through notificationSeverity() in labels.ts, never directly.
  severity?: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationListResponse {
  items: AdminNotification[]
  total: number
  page: number
  pageSize: number
}

/**
 * A run of consecutive, identical notifications collapsed into one row. The alert crons can
 * re-raise the same condition (e.g. a stale backup) every dedup window, which used to fill a
 * whole list with copies of one message and push everything else out of sight.
 */
export interface NotificationGroup {
  key: string
  head: AdminNotification
  items: AdminNotification[]
}

export function isSameMessage(a: AdminNotification, b: AdminNotification): boolean {
  return (
    a.type === b.type &&
    a.title === b.title &&
    a.body === b.body &&
    a.link === b.link &&
    (a.severity ?? null) === (b.severity ?? null)
  )
}

// Only CONSECUTIVE repeats collapse: a different notification in between breaks the run, so
// the list stays in true chronological order.
export function groupNotifications(list: AdminNotification[]): NotificationGroup[] {
  const out: NotificationGroup[] = []
  for (const notification of list) {
    const previous = out[out.length - 1]
    if (previous && isSameMessage(previous.head, notification)) {
      previous.items.push(notification)
    } else {
      out.push({ key: notification.id, head: notification, items: [notification] })
    }
  }
  return out
}

export function isGroupUnread(group: NotificationGroup): boolean {
  return group.items.some((n) => !n.readAt)
}

export function formatNotificationTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/**
 * Window event fired after the inbox page marks anything read, so the header bell's badge and
 * the layout's critical banner refresh at once instead of waiting out their 60s polls. (The
 * bell itself talks to the layout through its own `changed` emit.)
 */
export const NOTIFICATIONS_CHANGED_EVENT = 'admin-notifications-changed'

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
}
