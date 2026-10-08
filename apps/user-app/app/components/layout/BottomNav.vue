<script setup lang="ts">
import type { IconName } from '../ui/BaseIcon.vue'

// Phone-only tab bar (hidden from `md`, where the header carries the same destinations).
// The primary places a customer moves between -- discover, their bookings, their account --
// used to be two text links wrapped under the logo; a thumb-reachable bar is the standard
// answer for a mobile-first marketplace and keeps the header to a single row.
//
// Rendered by layouts/default.vue only on screens where it helps: it is deliberately absent
// from checkout (/booking/*) and a salon's own page, where a sticky primary action already
// owns the bottom edge and a second fixed bar would crowd it.
interface Tab { to: string; label: string; icon: IconName; match: (path: string) => boolean }

const session = useSessionStore()
const { flags } = useFeatureFlags()
const route = useRoute()

const tabs = computed<Tab[]>(() => {
  const home: Tab = { to: '/', label: 'خانه', icon: 'home', match: (p) => p === '/' }
  const salons: Tab = { to: '/salons', label: 'سالن‌ها', icon: 'search', match: (p) => p === '/salons' || p.startsWith('/salons/') }
  if (!session.isLoggedIn) {
    return [
      home,
      salons,
      { to: '/blog', label: 'بلاگ', icon: 'book-open', match: (p) => p === '/blog' || p.startsWith('/blog/') },
      { to: '/login', label: 'ورود', icon: 'user', match: (p) => p === '/login' },
    ]
  }
  const list: Tab[] = [home, salons]
  if (flags.value.beautyGuideEnabled) {
    list.push({ to: '/beauty-guide', label: 'راهنما', icon: 'sparkles', match: (p) => p.startsWith('/beauty-guide') })
  }
  list.push(
    { to: '/bookings', label: 'نوبت‌ها', icon: 'calendar', match: (p) => p === '/bookings' || p.startsWith('/bookings/') },
    { to: '/profile', label: 'پروفایل', icon: 'user', match: (p) => p === '/profile' || p.startsWith('/account/') },
  )
  return list
})
</script>

<template>
  <nav
    aria-label="ناوبری سریع"
    data-testid="bottom-nav"
    class="fixed inset-x-0 bottom-0 z-30 border-t border-(--color-border) bg-(--color-surface-card) md:hidden print:hidden"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <ul class="mx-auto flex max-w-lg items-stretch justify-around">
      <li v-for="tab in tabs" :key="tab.to" class="min-w-0 flex-1">
        <NuxtLink
          :to="tab.to"
          :aria-current="tab.match(route.path) ? 'page' : undefined"
          class="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium transition-colors"
          :class="tab.match(route.path) ? 'text-(--color-accent-text)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
        >
          <span
            class="flex h-7 w-12 items-center justify-center rounded-full transition-colors"
            :class="tab.match(route.path) ? 'bg-(--color-accent-soft)' : ''"
          >
            <BaseIcon :name="tab.icon" :size="20" />
          </span>
          <span class="truncate">{{ tab.label }}</span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
