<!-- apps/provider-panel/src/components/layout/BottomNav.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { formatNumber } from '@/utils/digits'
import { MORE_GROUPS } from './nav-config'
import { NAV_TABS, isTabActive } from './nav-tabs'

const props = withDefaults(defineProps<{ pendingCount?: number }>(), { pendingCount: 0 })

const route = useRoute()

function isActive(to: string) {
  return isTabActive(to, route.path)
}

// On a screen reached through «بیشتر» (team, hours, settings…) no tab is the page, but the
// owner should still see where they are: the «بیشتر» tab gets the visual highlight only --
// not aria-current, since /more itself is not the page being shown.
const onMoreScreen = computed(() => MORE_GROUPS.some((g) => g.items.some((i) => isTabActive(i.to, route.path))))
function isHighlighted(to: string) {
  return isActive(to) || (to === '/more' && onMoreScreen.value)
}

const pendingDescription = computed(() => `${formatNumber(props.pendingCount)} درخواست در انتظار تأیید`)
</script>

<template>
  <!--
    Phone / tablet-portrait navigation only: from lg up the grouped sidebar (AppLayout.vue)
    carries every destination, so a 1280px+ screen doesn't keep a phone bottom bar pinned
    across its full width.

    pb-[env(safe-area-inset-bottom)] keeps the labels and the active indicator clear of the
    iOS home indicator -- without it the bar's bottom row sits underneath it. AppLayout's
    own bottom padding adds the same inset so page content still clears the bar.
  -->
  <nav
    aria-label="ناوبری اصلی"
    class="fixed inset-x-0 bottom-0 z-30 flex border-t border-(--color-border) bg-(--color-surface-card)/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
  >
    <RouterLink
      v-for="tab in NAV_TABS"
      :key="tab.to"
      :to="tab.to"
      class="relative flex min-h-11 min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium text-(--color-text-muted) transition-colors"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
      :aria-describedby="tab.pendingBadge && pendingCount > 0 ? 'bottom-pending-desc' : undefined"
      :class="isHighlighted(tab.to) && 'text-(--color-accent-text)'"
    >
      <span class="relative">
        <AppIcon :name="tab.icon" :size="20" />
        <!-- aria-hidden so the tab's accessible name stays exactly its label; the count is
             read out through aria-describedby. -->
        <span
          v-if="tab.pendingBadge && pendingCount > 0"
          data-testid="bottom-pending-badge"
          aria-hidden="true"
          class="tnum absolute -top-1.5 -end-2.5 min-w-4.5 rounded-full bg-(--color-accent) px-1 text-center text-[11px] leading-4.5 font-bold text-(--color-fill-text) ring-2 ring-(--color-surface-card)"
        >{{ formatNumber(pendingCount) }}</span>
      </span>
      <!-- 320px / 6 tabs = 53px a piece (see nav-tabs.ts); truncate rather than let a label force the bar wider. -->
      <span class="max-w-full truncate">{{ tab.label }}</span>
      <span
        class="h-0.5 w-5 shrink-0 rounded-full transition-opacity"
        :class="isHighlighted(tab.to) ? 'bg-(--color-accent-text) opacity-100' : 'opacity-0'"
      />
    </RouterLink>
    <span id="bottom-pending-desc" class="sr-only">{{ pendingDescription }}</span>
  </nav>
</template>
