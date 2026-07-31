<!-- apps/provider-panel/src/components/layout/BottomNav.vue -->
<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { NAV_TABS, isTabActive } from './nav-tabs'

const route = useRoute()

function isActive(to: string) {
  return isTabActive(to, route.path)
}
</script>

<template>
  <!--
    Phone / tablet-portrait navigation only: from lg up the same destinations render as an
    inline row in the header (AppLayout.vue), so a 1280px+ screen doesn't keep a phone
    bottom bar pinned across its full width.

    pb-[env(safe-area-inset-bottom)] keeps the labels and the active indicator clear of the
    iOS home indicator -- without it the bar's bottom row sits underneath it. AppLayout's
    own bottom padding adds the same inset so page content still clears the bar.
  -->
  <nav
    class="fixed inset-x-0 bottom-0 z-30 flex border-t border-(--color-border) bg-(--color-surface-card)/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
  >
    <RouterLink
      v-for="tab in NAV_TABS"
      :key="tab.to"
      :to="tab.to"
      class="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium text-(--color-text-muted) transition-colors"
      :class="isActive(tab.to) && 'text-(--color-accent)'"
    >
      <AppIcon :name="tab.icon" :size="20" />
      <!-- 320px / 5 tabs = 64px a piece; truncate rather than let a label force the bar wider. -->
      <span class="max-w-full truncate">{{ tab.label }}</span>
      <span
        class="h-0.5 w-5 shrink-0 rounded-full transition-opacity"
        :class="isActive(tab.to) ? 'bg-(--color-accent) opacity-100' : 'opacity-0'"
      />
    </RouterLink>
  </nav>
</template>
