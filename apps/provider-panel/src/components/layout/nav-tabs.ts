// apps/provider-panel/src/components/layout/nav-tabs.ts
import type { IconName } from '@/components/ui/AppIcon.vue'
import { NAV_ITEMS, isNavActive } from './nav-config'

export interface NavTab {
  to: string
  label: string
  icon: IconName
  pendingBadge?: boolean
}

/**
 * The phone bottom bar (BottomNav.vue, below lg): the five `bottom` destinations from the one
 * grouped nav config (nav-config.ts), then «بیشتر» (/more) for everything else. From lg up the
 * full grouped sidebar replaces this bar.
 *
 * Six tabs at the 320px minimum phone width is 320 / 6 = 53px per tab: above the 44px
 * touch-target floor, and wide enough for a 11px label (the longest, «داشبورد», is ~40px)
 * inside the 4px side padding BottomNav gives each tab; anything longer truncates.
 */
export const NAV_TABS: NavTab[] = [
  ...NAV_ITEMS.filter((i) => i.bottom).map(({ to, label, icon, pendingBadge }) => ({ to, label, icon, pendingBadge })),
  { to: '/more', label: 'بیشتر', icon: 'more' },
]

export const isTabActive = isNavActive
