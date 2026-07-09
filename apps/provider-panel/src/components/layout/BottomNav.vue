<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

const route = useRoute()

const TABS: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'داشبورد', icon: 'dashboard' },
  { to: '/bookings', label: 'نوبت‌ها', icon: 'bookings' },
  { to: '/services', label: 'خدمات', icon: 'services' },
  { to: '/reviews', label: 'نظرات', icon: 'reviews' },
  { to: '/earnings', label: 'درآمد', icon: 'earnings' },
]

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 z-30 flex border-t border-(--color-border) bg-(--color-surface-card)/95 backdrop-blur">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      class="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-(--color-muted) transition-colors"
      :class="isActive(tab.to) && 'text-(--color-accent)'"
    >
      <AppIcon :name="tab.icon" :size="20" />
      {{ tab.label }}
      <span
        class="h-0.5 w-5 rounded-full transition-opacity"
        :class="isActive(tab.to) ? 'bg-(--color-accent) opacity-100' : 'opacity-0'"
      />
    </RouterLink>
  </nav>
</template>
