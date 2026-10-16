<!-- apps/admin-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { toPersianDigits } from '@/utils/digits'
import { NOTIFICATIONS_CHANGED_EVENT } from '@/utils/notifications'
import AccountMenu from './AccountMenu.vue'
import MobileNavDrawer from './MobileNavDrawer.vue'
import NotificationBell from './NotificationBell.vue'
import SidebarNav from './SidebarNav.vue'

const route = useRoute()
const { apiFetch } = useApi()

// Phone navigation drawer. Focus goes back to the hamburger that opened it, so a keyboard
// user isn't dropped at the top of the page every time they dismiss the menu.
const navOpen = ref(false)
const menuButton = ref<HTMLButtonElement | null>(null)
watch(navOpen, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen) {
    await nextTick()
    menuButton.value?.focus()
  }
})

// Unread CRITICAL operator alerts (AlertsService -> type 'alert' raised as critical: stuck
// refunds, failed backups, cron failures). This banner keeps them in view on every page until
// someone reads them. The count is the API's own per-severity breakdown of the caller's unread
// rows (`unread-counts`), so it is exact however many notifications are unread, and it uses
// the same effective-severity rule as the inbox filter the banner links to: a legacy alert
// with no stored severity counts as a warning, never as critical.
const ALERT_POLL_MS = 60_000
const unreadAlerts = ref(0)
async function loadUnreadAlerts() {
  const { data } = await apiFetch<{ total: number; critical: number; warning: number; info: number }>(
    '/admin/notifications/unread-counts',
    { silent: true },
  )
  // A failed poll keeps the last known state rather than flashing the banner away.
  if (typeof data?.critical !== 'number') return
  unreadAlerts.value = data.critical
}

const alertCountText = computed(() => toPersianDigits(unreadAlerts.value))

function pollAlertsIfVisible() {
  if (document.visibilityState === 'visible') loadUnreadAlerts()
}
let alertTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  loadUnreadAlerts()
  alertTimer = setInterval(pollAlertsIfVisible, ALERT_POLL_MS)
  document.addEventListener('visibilitychange', pollAlertsIfVisible)
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, loadUnreadAlerts)
})
onUnmounted(() => {
  if (alertTimer !== undefined) clearInterval(alertTimer)
  document.removeEventListener('visibilitychange', pollAlertsIfVisible)
  window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, loadUnreadAlerts)
})
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-(--color-surface)">
    <!-- From `md` up: the permanent 16rem sidebar. Below it, the same nav lives in the
         off-canvas drawer opened from the header's hamburger, so a phone gets the full width
         for content instead of a 64px icon rail. -->
    <aside class="hidden h-screen w-64 shrink-0 overflow-y-auto border-e border-(--color-border) bg-(--color-surface-card) px-3 py-4 md:block">
      <SidebarNav />
    </aside>
    <MobileNavDrawer v-model="navOpen" />
    <!-- `min-w-0` is load-bearing, not decoration: a flex child defaults to
         `min-width: auto`, so this column would refuse to shrink below its widest page and
         push the sidebar off-screen. `overflow-hidden` already implies a 0 automatic minimum
         size, but stating it keeps the guarantee from silently disappearing if the overflow
         value is ever relaxed. -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- One ~56px row at every width: hamburger (phones), page title, then the bell and the
           account menu, which now holds the theme switch and logout. Nothing here wraps, so the
           phone header no longer drops its actions onto a second row. -->
      <header class="flex h-14 shrink-0 items-center gap-2 border-b border-(--color-border) bg-(--color-surface-card) px-2 sm:gap-3 sm:px-4 md:h-16 md:px-6">
        <button
          ref="menuButton"
          type="button"
          aria-label="منو"
          aria-controls="mobile-nav-drawer"
          :aria-expanded="navOpen"
          aria-haspopup="dialog"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text) md:hidden"
          @click="navOpen = true"
        >
          <AppIcon name="menu" :size="20" />
        </button>

        <h1 class="min-w-0 flex-1 truncate text-base font-bold text-(--color-text) md:text-lg">{{ route.meta.title ?? '' }}</h1>

        <div class="flex shrink-0 items-center gap-1 sm:gap-2">
          <NotificationBell @changed="loadUnreadAlerts" />
          <div class="hidden h-6 w-px bg-(--color-border) md:block" />
          <AccountMenu />
        </div>
      </header>

      <!-- Critical-alert strip. role="status" rather than "alert": it is persistent page chrome
           re-rendered by a poll, and an assertive live region would re-announce on every tick. -->
      <div
        v-if="unreadAlerts > 0"
        role="status"
        data-testid="critical-alert-banner"
        class="flex shrink-0 items-center gap-3 border-b border-(--tone-danger-text)/25 bg-(--tone-danger-bg) px-4 py-2 text-sm text-(--tone-danger-text) md:px-6"
      >
        <AppIcon name="warning" :size="18" class="shrink-0" />
        <p class="min-w-0 flex-1">
          <span class="font-bold"><bdi dir="ltr" class="tnum">{{ alertCountText }}</bdi> هشدار بحرانی خوانده‌نشده</span>
          <span class="hidden sm:inline"> — مشکلات مالی یا سیستمی که به رسیدگی نیاز دارند.</span>
        </p>
        <!-- To the inbox pre-filtered to exactly what this banner counts. -->
        <RouterLink
          to="/notifications?severity=critical&unread=true"
          data-testid="critical-alert-open"
          class="flex min-h-11 shrink-0 items-center rounded-lg px-2.5 text-sm font-bold underline-offset-4 hover:underline"
        >
          مشاهده
        </RouterLink>
      </div>
      <!-- Explicitly `overflow-auto`, not just `overflow-y-auto`: this is the app's single
           horizontal scroll container. A page that is genuinely too wide for the viewport
           (the dense tables this admin tool is built around) scrolls here, so the document
           body itself never gets a horizontal scrollbar at any width. -->
      <main class="route-outlet flex-1 overflow-auto">
        <!--
          No `mode="out-in"` here -- deliberately. Every route component below is lazy
          (`() => import(...)` in router/index.ts), which Vue Router hands this slot as an
          async component. `mode="out-in"` waits for the leave transition to finish, THEN
          mounts the incoming node and waits for its own enter hooks before considering the
          cycle done -- but the first time an incoming async component doesn't resolve
          synchronously (a not-yet-cached chunk: echarts, markdown-it, vue-multiselect are all
          only pulled in by specific routes), that wait never resolves and Transition's out-in
          state machine gets permanently wedged. Every navigation after that swaps `Component`
          correctly but the transition wrapper never mounts it, leaving the header/nav live
          over a blank <main> until a full reload resets Vue's tree. Default (simultaneous)
          mode has no such wait, at the cost of old/new briefly overlapping during the fade
          instead of a clean sequential swap -- confirmed via a scripted multi-route
          navigation sweep that this trade eliminates the wedge entirely.
        -->
        <RouterView v-slot="{ Component, route: current }">
          <Transition name="page-fade">
            <component :is="Component" :key="current.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
