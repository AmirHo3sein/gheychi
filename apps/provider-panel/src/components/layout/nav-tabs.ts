// apps/provider-panel/src/components/layout/nav-tabs.ts
import type { IconName } from '@/components/ui/AppIcon.vue'

export interface NavTab {
  to: string
  label: string
  icon: IconName
}

/**
 * The panel's primary destinations. Rendered twice -- as the phone bottom bar
 * (BottomNav.vue) and as an inline row in the header on lg+ (AppLayout.vue) -- so the
 * list and its active-route rule live here rather than being duplicated per surface.
 * The remaining screens (hours, photos, stories, portfolio, coupons, team, settings)
 * are reached from the dashboard's quick-link grid at every width.
 */
export const NAV_TABS: NavTab[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/bookings', label: 'نوبت‌ها', icon: 'bookings' },
  { to: '/services', label: 'خدمات', icon: 'services' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/earnings', label: 'درآمد', icon: 'earnings' },
]

export function isTabActive(to: string, path: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)
}
