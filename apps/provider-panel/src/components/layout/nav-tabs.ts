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
 * The remaining screens (customers, hours, photos, stories, portfolio, packages, coupons,
 * team, settings, plan) live behind the last tab, «بیشتر» (/more), as well as on the
 * dashboard's quick-link grid.
 *
 * Six tabs at the 320px minimum phone width is 320 / 6 = 53px per tab: above the 44px
 * touch-target floor, and wide enough for a 11px label (the longest, «داشبورد», is ~40px)
 * inside the 4px side padding BottomNav gives each tab; anything longer truncates.
 */
export const NAV_TABS: NavTab[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/bookings', label: 'نوبت‌ها', icon: 'bookings' },
  { to: '/services', label: 'خدمات', icon: 'services' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/earnings', label: 'درآمد', icon: 'earnings' },
  { to: '/more', label: 'بیشتر', icon: 'more' },
]

export function isTabActive(to: string, path: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)
}
