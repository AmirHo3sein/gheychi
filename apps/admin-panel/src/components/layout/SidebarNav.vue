<!-- apps/admin-panel/src/components/layout/SidebarNav.vue -->
<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/salons', label: 'آرایشگاه‌ها', icon: 'salons' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/categories', label: 'دسته‌بندی‌ها', icon: 'categories' },
  { to: '/users', label: 'کاربران', icon: 'users' },
  { to: '/config', label: 'تنظیمات', icon: 'config' },
]

const route = useRoute()

// vue-router's default (non-exact) active-class marks EVERY link active on EVERY page here,
// because the layout's own route ('/') is a shared ancestor in every child route's `matched`
// array -- a classic gotcha with an empty-path index route. Exact string comparison for the
// dashboard root, prefix match for everything else (so /salons/:id still highlights "Salons").
function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav class="flex h-screen w-64 shrink-0 flex-col border-l border-(--color-border) bg-(--color-surface-card) py-4">
    <div class="flex-1 space-y-1 overflow-y-auto px-3">
      <RouterLink
        v-for="link in LINKS"
        :key="link.to"
        :to="link.to"
        class="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
        :class="isActive(link.to) && 'bg-(--tone-info-bg) font-bold text-(--color-accent) hover:bg-(--tone-info-bg) hover:text-(--color-accent)'"
      >
        <span
          v-if="isActive(link.to)"
          class="absolute right-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-(--color-accent)"
        />
        <AppIcon :name="link.icon" :size="19" />
        {{ link.label }}
      </RouterLink>
    </div>
  </nav>
</template>
