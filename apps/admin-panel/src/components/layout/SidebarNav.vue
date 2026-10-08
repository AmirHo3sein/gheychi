<!-- apps/admin-panel/src/components/layout/SidebarNav.vue -->
<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

interface NavLink {
  to: string
  label: string
  icon: IconName
}
interface NavGroup {
  id: string
  heading: string
  links: NavLink[]
}

// Grouped by the job an admin is doing, not by feature age. Each link has its own icon (two
// links sharing a glyph, or a "plus" that reads as "add something", send people to the wrong
// page). Labels match each page's own <h1> (router `meta.title`) so the nav and the page
// header never disagree about what a screen is called.
const GROUPS: NavGroup[] = [
  {
    id: 'overview',
    heading: 'نمای کلی',
    links: [
      { to: '/', label: 'داشبورد', icon: 'dashboard' },
      { to: '/analytics', label: 'آمار و تحلیل', icon: 'chart' },
    ],
  },
  {
    id: 'salons',
    heading: 'آرایشگاه‌ها و رزروها',
    links: [
      { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons' },
      { to: '/featured', label: 'سالن‌های ویژه', icon: 'crown' },
      { to: '/bookings', label: 'رزروها', icon: 'calendar' },
    ],
  },
  {
    id: 'moderation',
    heading: 'نظارت',
    links: [
      { to: '/reviews', label: 'نظرات', icon: 'message' },
      { to: '/worker-ratings', label: 'امتیاز کارمندان', icon: 'worker-ratings' },
      { to: '/reports', label: 'گزارش‌ها', icon: 'flag' },
      { to: '/category-requests', label: 'درخواست‌های دسته‌بندی', icon: 'inbox' },
    ],
  },
  {
    id: 'catalog',
    heading: 'کاتالوگ',
    links: [
      { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories' },
      { to: '/beauty-concepts', label: 'مفاهیم راهنمای زیبایی', icon: 'sparkles' },
      { to: '/blog', label: 'بلاگ', icon: 'newspaper' },
    ],
  },
  {
    id: 'money',
    heading: 'مالی',
    links: [
      { to: '/coupons', label: 'کدهای تخفیف', icon: 'coupon' },
      { to: '/plans', label: 'پلن‌های اشتراک', icon: 'plan' },
      { to: '/subscription-coupons', label: 'کدهای تخفیف اشتراک', icon: 'badge-percent' },
      { to: '/wallet', label: 'کیف پول', icon: 'wallet' },
      { to: '/invoices', label: 'صورتحساب‌ها', icon: 'invoice' },
      { to: '/referrals', label: 'معرفی‌ها', icon: 'user-plus' },
      { to: '/referrals/settings', label: 'تنظیمات معرفی', icon: 'gift' },
    ],
  },
  {
    id: 'system',
    heading: 'سیستم',
    links: [
      { to: '/users', label: 'کاربران', icon: 'users' },
      { to: '/audit-log', label: 'تاریخچه اقدامات', icon: 'history' },
      { to: '/config', label: 'تنظیمات پلتفرم', icon: 'config' },
      { to: '/feature-flags', label: 'ویژگی‌های پلتفرم', icon: 'toggle' },
    ],
  },
]

const ALL_LINKS: NavLink[] = GROUPS.flatMap((group) => group.links)

// Fired on every link click so the phone drawer can close even when the target is the page
// already showing (no route change, so a route watcher alone would leave it open).
const emit = defineEmits<{ navigate: [] }>()

const route = useRoute()

// vue-router's default (non-exact) active-class marks EVERY link active on EVERY page here,
// because the layout's own route ('/') is a shared ancestor in every child route's `matched`
// array -- a classic gotcha with an empty-path index route. Exact string comparison for the
// dashboard root, prefix match for everything else (so /salons/:id still highlights "Salons").
//
// The prefix match alone would double-highlight '/referrals' when on '/referrals/settings'
// (a sibling nav item, not a detail sub-route of the referrals list, unlike /salons/:id which
// has no competing static link in the list) -- so a prefix match yields to any other link in
// the list that matches the current path with a longer (more specific) prefix.
function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (route.path === to) return true
  if (!route.path.startsWith(`${to}/`)) return false
  return !ALL_LINKS.some(
    (link) => link.to !== to && link.to.length > to.length && (route.path === link.to || route.path.startsWith(`${link.to}/`)),
  )
}
</script>

<!-- Just the navigation: the surrounding chrome (the fixed 16rem sidebar from `md` up, the
     off-canvas drawer below it) lives in AppLayout / MobileNavDrawer so the one link list
     renders identically, labels and section headings included, in both. -->
<template>
  <nav aria-label="منوی اصلی" class="space-y-4">
    <div v-for="group in GROUPS" :key="group.id" data-testid="nav-group">
      <p :id="`nav-heading-${group.id}`" class="mb-1 px-3 text-[11px] font-bold text-(--color-text-muted)">{{ group.heading }}</p>
      <ul :aria-labelledby="`nav-heading-${group.id}`" class="space-y-0.5">
        <li v-for="link in group.links" :key="link.to">
          <RouterLink
            :to="link.to"
            :aria-current="isActive(link.to) ? 'page' : undefined"
            class="group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text) md:min-h-9 md:py-2"
            :class="isActive(link.to) && 'bg-(--tone-info-bg) font-bold text-(--color-accent-text) hover:bg-(--tone-info-bg) hover:text-(--color-accent-text)'"
            @click="emit('navigate')"
          >
            <!-- Logical `start-0`, not `right-0`: identical in this RTL-only app, but an
                 inset/overflow bug in RTL escapes to the LEFT, which is easy to miss. -->
            <span
              v-if="isActive(link.to)"
              class="absolute start-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-(--color-accent)"
            />
            <AppIcon :name="link.icon" :size="19" class="shrink-0" />
            <span>{{ link.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </nav>
</template>
