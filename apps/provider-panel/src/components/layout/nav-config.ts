// apps/provider-panel/src/components/layout/nav-config.ts
import type { IconName } from '@/components/ui/AppIcon.vue'

export interface NavItem {
  to: string
  label: string
  icon: IconName
  /**
   * Also a phone bottom-bar tab. Everything else is reached on phones through «بیشتر»
   * (/more), which lists exactly the items without this flag.
   */
  bottom?: boolean
  /** Shows the live pending-approval count (usePendingApprovals) beside the label. */
  pendingBadge?: boolean
}

export interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

/**
 * The panel's whole navigation, in one place. Rendered three ways: as the grouped desktop
 * sidebar (AppLayout.vue, lg+), as the phone bottom bar (the `bottom` items, BottomNav.vue)
 * and as the «بیشتر» page (every other item, MoreView.vue) -- so a new screen is added here
 * once and is reachable at every width.
 *
 * Grouped by the owner's working day rather than by data type: what needs attention today,
 * then the people, the catalogue, the staff and schedule, the public storefront, the money,
 * growth, and finally settings.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'today',
    label: 'امروز',
    items: [
      { to: '/', label: 'داشبورد', icon: 'dashboard', bottom: true },
      { to: '/bookings', label: 'نوبت‌ها', icon: 'bookings', bottom: true, pendingBadge: true },
    ],
  },
  {
    key: 'customers',
    label: 'مشتریان',
    items: [
      { to: '/customers', label: 'مشتریان', icon: 'customers', bottom: true },
      { to: '/reviews', label: 'نظرات', icon: 'reviews' },
    ],
  },
  {
    key: 'catalog',
    label: 'خدمات و قیمت‌ها',
    items: [
      { to: '/services', label: 'خدمات', icon: 'services', bottom: true },
      { to: '/packages', label: 'پکیج‌ها', icon: 'packages' },
      { to: '/coupons', label: 'کدهای تخفیف', icon: 'coupons' },
    ],
  },
  {
    key: 'team',
    label: 'تیم و ساعات',
    items: [
      { to: '/team', label: 'تیم', icon: 'team' },
      { to: '/hours', label: 'ساعات کاری', icon: 'hours' },
    ],
  },
  {
    key: 'showcase',
    label: 'ویترین',
    items: [
      { to: '/photos', label: 'تصاویر', icon: 'photos' },
      { to: '/stories', label: 'استوری‌ها', icon: 'stories' },
      { to: '/portfolio', label: 'نمونه کارها', icon: 'portfolio' },
    ],
  },
  {
    key: 'money',
    label: 'درآمد و اشتراک',
    items: [
      { to: '/earnings', label: 'درآمد', icon: 'earnings', bottom: true },
      { to: '/plan', label: 'اشتراک من', icon: 'plan' },
    ],
  },
  {
    key: 'growth',
    label: 'رشد',
    items: [{ to: '/referral', label: 'معرفی و کیف پول', icon: 'referral' }],
  },
  {
    key: 'settings',
    label: 'تنظیمات',
    items: [{ to: '/settings', label: 'تنظیمات سالن', icon: 'settings' }],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/** The «بیشتر» page: each group with only its items that are not already bottom-bar tabs. */
export const MORE_GROUPS: NavGroup[] = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.bottom) })).filter(
  (g) => g.items.length > 0,
)

export function isNavActive(to: string, path: string): boolean {
  return to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`)
}
