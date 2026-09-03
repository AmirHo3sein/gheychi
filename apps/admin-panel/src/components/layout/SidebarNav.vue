<!-- apps/admin-panel/src/components/layout/SidebarNav.vue -->
<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/analytics', label: 'آمار و تحلیل', icon: 'chart' },
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons' },
  { to: '/featured', label: 'سالن‌های ویژه', icon: 'star' },
  { to: '/bookings', label: 'رزروها', icon: 'calendar' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/worker-ratings', label: 'امتیاز کارمندان', icon: 'worker-ratings' },
  { to: '/reports', label: 'گزارش‌ها', icon: 'flag' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories' },
  { to: '/category-requests', label: 'درخواست‌های دسته‌بندی', icon: 'plus' },
  { to: '/coupons', label: 'کدهای تخفیف', icon: 'coupon' },
  { to: '/plans', label: 'پلن‌های اشتراک', icon: 'plan' },
  { to: '/subscription-coupons', label: 'کدهای تخفیف اشتراک', icon: 'coupon' },
  { to: '/wallet', label: 'کیف پول', icon: 'wallet' },
  { to: '/invoices', label: 'صورتحساب‌ها', icon: 'invoice' },
  { to: '/referrals', label: 'معرفی‌ها', icon: 'user-plus' },
  { to: '/blog', label: 'بلاگ', icon: 'newspaper' },
  { to: '/users', label: 'کاربران', icon: 'users' },
  { to: '/audit-log', label: 'تاریخچه اقدامات', icon: 'history' },
  { to: '/referrals/settings', label: 'تنظیمات معرفی', icon: 'gift' },
  { to: '/config', label: 'تنظیمات', icon: 'config' },
  { to: '/feature-flags', label: 'ویژگی‌ها', icon: 'toggle' },
]

const route = useRoute()

// vue-router's default (non-exact) active-class marks EVERY link active on EVERY page here,
// because the layout's own route ('/') is a shared ancestor in every child route's `matched`
// array -- a classic gotcha with an empty-path index route. Exact string comparison for the
// dashboard root, prefix match for everything else (so /salons/:id still highlights "Salons").
//
// The prefix match alone would double-highlight '/referrals' when on '/referrals/settings'
// (a sibling nav item, not a detail sub-route of the referrals list, unlike /salons/:id which
// has no competing static link in LINKS) -- so a prefix match yields to any other link in this
// same list that matches the current path with a longer (more specific) prefix.
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (route.path === to) return true
  if (!route.path.startsWith(`${to}/`)) return false
  return !LINKS.some(
    (link) => link.to !== to && link.to.length > to.length && (route.path === link.to || route.path.startsWith(`${link.to}/`)),
  )
}
</script>

<!-- 16rem rail from `md` up -- the desktop-primary layout this panel is designed for,
     unchanged. Below `md` a 256px sidebar would leave 64px of content on a 320px screen,
     clipping every control on the page rather than merely cramping it, so it narrows to an
     icon-only rail there. Deliberately NOT an off-canvas drawer: navigation stays
     permanently visible and this app stays desktop-primary (PRODUCT.md). -->
<template>
  <nav class="flex h-screen w-16 shrink-0 flex-col border-e border-(--color-border) bg-(--color-surface-card) py-4 md:w-64">
    <div class="flex-1 space-y-1 overflow-y-auto px-2 md:px-3">
      <RouterLink
        v-for="link in LINKS"
        :key="link.to"
        :to="link.to"
        :title="link.label"
        :aria-label="link.label"
        class="group relative flex min-h-11 items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text) md:min-h-0 md:justify-start"
        :class="isActive(link.to) && 'bg-(--tone-info-bg) font-bold text-(--color-accent-text) hover:bg-(--tone-info-bg) hover:text-(--color-accent-text)'"
      >
        <!-- Logical `start-0`, not `right-0`: identical in this RTL-only app, but an
             inset/overflow bug in RTL escapes to the LEFT, which is easy to miss. -->
        <span
          v-if="isActive(link.to)"
          class="absolute start-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-(--color-accent)"
        />
        <AppIcon :name="link.icon" :size="19" class="shrink-0" />
        <!-- Hidden, not dropped, on the icon rail -- `title`/`aria-label` above carry the
             accessible name so a collapsed link is never anonymous. -->
        <span class="hidden md:inline">{{ link.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
