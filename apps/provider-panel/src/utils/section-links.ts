import type { IconName } from '@/components/ui/AppIcon.vue'

export interface SectionLink {
  to: string
  label: string
  icon: IconName
  group: 'customers' | 'salon' | 'manage'
}

/**
 * The secondary screens the bottom bar has no room for. One list feeds both the dashboard's
 * quick-link grid and the «بیشتر» page (MoreView.vue), so a new screen is added in one place.
 */
export const SECTION_LINKS: SectionLink[] = [
  { to: '/customers', label: 'مشتریان', icon: 'customers', group: 'customers' },
  { to: '/coupons', label: 'کدهای تخفیف', icon: 'coupons', group: 'customers' },
  { to: '/packages', label: 'پکیج‌ها', icon: 'packages', group: 'customers' },
  { to: '/photos', label: 'تصاویر', icon: 'photos', group: 'salon' },
  { to: '/stories', label: 'استوری‌ها', icon: 'stories', group: 'salon' },
  { to: '/portfolio', label: 'نمونه کارها', icon: 'portfolio', group: 'salon' },
  { to: '/hours', label: 'ساعات کاری', icon: 'hours', group: 'manage' },
  { to: '/team', label: 'تیم', icon: 'team', group: 'manage' },
  { to: '/settings', label: 'تنظیمات', icon: 'settings', group: 'manage' },
  { to: '/plan', label: 'پلن من', icon: 'plan', group: 'manage' },
]

export const SECTION_GROUPS: Array<{ key: SectionLink['group']; label: string }> = [
  { key: 'customers', label: 'مشتریان و فروش' },
  { key: 'salon', label: 'معرفی سالن' },
  { key: 'manage', label: 'مدیریت سالن' },
]
