<!-- apps/admin-panel/src/components/layout/NotificationBell.vue -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import { NOTIFICATION_SEVERITY_LABEL, notificationSeverity, notificationTypeMeta, type NotificationSeverity } from '@/utils/labels'
import { toPersianDigits } from '@/utils/digits'
import {
  NOTIFICATIONS_CHANGED_EVENT,
  formatNotificationTime as formatTime,
  groupNotifications,
  isGroupUnread as isUnread,
  type AdminNotification,
  type NotificationGroup,
  type NotificationListResponse,
} from '@/utils/notifications'

const POLL_INTERVAL_MS = 60_000

// Fired after anything this panel marks read, so the layout's critical-alert banner can
// refresh without waiting out its own poll.
const emit = defineEmits<{ changed: [] }>()

const router = useRouter()
const { apiFetch } = useApi()

const root = ref<HTMLElement | null>(null)
const bellButton = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const count = ref(0)
const notifications = ref<AdminNotification[]>([])
const loadingList = ref(false)
// One string drives both the visible badge and the accessible name (WCAG 2.5.3: the
// visible text must be contained in the name).
const badgeText = computed(() => (count.value > 99 ? '۹۹+' : count.value.toLocaleString('fa-IR')))

const panel = ref<HTMLElement | null>(null)
// Horizontal correction applied to the open panel so it can never sit outside the viewport.
// The bell lives at the inline-END of the header, so this 20rem panel hangs toward the
// inline-START -- and in RTL that direction is *past the scroll origin*, i.e. overflow there
// is not reachable by scrolling at all (the mirror image of a negative `left` in LTR). On any
// layout with room -- every viewport this desktop-primary panel actually targets -- the
// measured shift is 0 and nothing moves. Same technique as JalaliDatePicker.vue's popover.
const panelShiftX = ref(0)
const VIEWPORT_MARGIN_PX = 8

let pollTimer: ReturnType<typeof setInterval> | undefined

const groups = computed<NotificationGroup[]>(() => groupNotifications(notifications.value))

const SEVERITY_ICON_CLASS: Record<NotificationSeverity, string> = {
  critical: 'bg-(--tone-danger-bg) text-(--tone-danger-text)',
  warning: 'bg-(--tone-warning-bg) text-(--tone-warning-text)',
  action: 'bg-(--color-accent-soft) text-(--color-accent-text)',
  info: 'bg-(--color-border-soft) text-(--color-text-muted)',
}

async function loadCount() {
  // silent: a failed badge poll must never toast, and the next tick simply retries.
  const { data } = await apiFetch<{ count: number }>('/admin/notifications/unread-count', { silent: true })
  if (data) count.value = data.count
}

async function loadList() {
  loadingList.value = true
  const { data } = await apiFetch<NotificationListResponse>('/admin/notifications?page=1&pageSize=10', {
    silent: true,
  })
  notifications.value = data?.items ?? []
  loadingList.value = false
}

// Measured from the rendered box rather than computed from the trigger's position, so it
// stays correct however the header wraps around it.
async function keepPanelOnScreen() {
  panelShiftX.value = 0
  if (!open.value) return
  await nextTick()
  const el = panel.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.left < VIEWPORT_MARGIN_PX) {
    panelShiftX.value = VIEWPORT_MARGIN_PX - rect.left
  } else if (rect.right > window.innerWidth - VIEWPORT_MARGIN_PX) {
    panelShiftX.value = window.innerWidth - VIEWPORT_MARGIN_PX - rect.right
  }
}

async function toggle() {
  open.value = !open.value
  keepPanelOnScreen()
  // Refresh the count too, so the badge can't lag the freshly-loaded list by up to a poll tick.
  if (open.value) await Promise.all([loadList(), loadCount()])
}

async function openGroup(group: NotificationGroup) {
  const unread = group.items.filter((n) => !n.readAt)
  if (unread.length > 0) {
    const results = await Promise.all(
      unread.map((n) => apiFetch(`/admin/notifications/${n.id}/read`, { method: 'PATCH', silent: true })),
    )
    const now = new Date().toISOString()
    let marked = 0
    results.forEach((result, i) => {
      if (!result.error) {
        unread[i]!.readAt = now
        marked++
      }
    })
    count.value = Math.max(0, count.value - marked)
    if (marked > 0) emit('changed')
  }
  open.value = false
  if (group.head.link) await router.push(group.head.link)
}

async function markAllRead() {
  const { error } = await apiFetch('/admin/notifications/read-all', { method: 'POST', silent: true })
  if (!error) {
    count.value = 0
    const now = new Date().toISOString()
    for (const notification of notifications.value) notification.readAt = notification.readAt ?? now
    emit('changed')
  }
}


function onDocumentClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

// Escape closes and hands focus back to the bell, so a keyboard user keeps their place.
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  e.stopPropagation()
  open.value = false
  bellButton.value?.focus()
}

// The badge poll is pure waste in a background tab: skip it while hidden, and catch up the
// moment the tab is shown again rather than waiting out up to a full interval of stale count.
function pollIfVisible() {
  if (document.visibilityState === 'visible') loadCount()
}

onMounted(() => {
  loadCount()
  pollTimer = setInterval(pollIfVisible, POLL_INTERVAL_MS)
  document.addEventListener('visibilitychange', pollIfVisible)
  document.addEventListener('mousedown', onDocumentClick)
  window.addEventListener('resize', keepPanelOnScreen)
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, loadCount)
})

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', pollIfVisible)
  document.removeEventListener('mousedown', onDocumentClick)
  window.removeEventListener('resize', keepPanelOnScreen)
  window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, loadCount)
})
</script>

<template>
  <div ref="root" class="relative" @keydown="onKeydown">
    <button
      ref="bellButton"
      data-testid="notification-bell"
      type="button"
      title="اعلان‌ها"
      :aria-label="count > 0 ? `اعلان‌ها، ${badgeText} خوانده‌نشده` : 'اعلان‌ها'"
      aria-haspopup="true"
      :aria-expanded="open"
      aria-controls="notification-panel"
      class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
      @click="toggle"
    >
      <AppIcon name="bell" :size="18" />
      <span
        v-if="count > 0"
        data-testid="unread-badge"
        class="tnum absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-danger-strong) px-1 text-[10px] font-bold text-(--color-fill-text)"
      >
        <!-- ltr isolate so "۹۹+" keeps its plus on the end instead of flipping to "+۹۹". -->
        <bdi dir="ltr">{{ badgeText }}</bdi>
      </span>
    </button>

    <!-- max-width keeps the panel itself from ever being wider than the viewport; the
         measured `panelShiftX` above keeps it from being *positioned* outside it. -->
    <div
      v-if="open"
      id="notification-panel"
      ref="panel"
      data-testid="notification-dropdown"
      class="absolute end-0 z-50 mt-1.5 w-80 sm:w-96 max-w-[calc(100vw-1rem)] rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-md)"
      :style="panelShiftX === 0 ? undefined : { transform: `translateX(${panelShiftX}px)` }"
    >
      <div class="flex items-center justify-between border-b border-(--color-border-soft) px-4 py-2.5">
        <p class="text-sm font-bold text-(--color-text)">اعلان‌ها</p>
        <button
          data-testid="mark-all-read"
          type="button"
          class="text-xs font-semibold text-(--color-accent-text) transition-opacity hover:opacity-80"
          @click="markAllRead"
        >
          خواندن همه
        </button>
      </div>

      <p v-if="!loadingList && notifications.length === 0" class="px-4 py-8 text-center text-sm text-(--color-text-muted)">
        اعلانی وجود ندارد.
      </p>

      <ul v-else class="max-h-[28rem] overflow-y-auto py-1">
        <li v-for="group in groups" :key="group.key">
          <button
            type="button"
            data-testid="notification-item"
            :data-severity="notificationSeverity(group.head)"
            class="relative flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-(--color-border-soft)"
            :class="notificationSeverity(group.head) === 'critical' && isUnread(group) && 'bg-(--tone-danger-bg)/40'"
            @click="openGroup(group)"
          >
            <!-- Severity is carried three ways -- icon tile colour, a start-edge stripe and a
                 text chip («بحرانی» / «هشدار») -- so an alert never relies on colour alone. -->
            <span
              v-if="notificationSeverity(group.head) === 'critical' || notificationSeverity(group.head) === 'warning'"
              class="absolute inset-y-2 start-0 w-1 rounded-full"
              :class="notificationSeverity(group.head) === 'critical' ? 'bg-(--tone-danger-text)' : 'bg-(--tone-warning-text)'"
              aria-hidden="true"
            />
            <span
              class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              :class="SEVERITY_ICON_CLASS[notificationSeverity(group.head)]"
            >
              <AppIcon :name="notificationTypeMeta(group.head.type).icon" :size="16" />
            </span>
            <!-- Titles/bodies are server-composed strings that can carry a salon name or an
                 id with no break opportunity -- `break-words` keeps one from widening the
                 panel past the clamp above. -->
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex w-full min-w-0 items-center gap-1.5">
                <span
                  v-if="notificationSeverity(group.head) === 'critical'"
                  class="shrink-0 rounded-full bg-(--tone-danger-text) px-1.5 py-px text-[11px] font-bold text-(--color-surface-card)"
                >{{ NOTIFICATION_SEVERITY_LABEL.critical }}</span>
                <span
                  v-else-if="notificationSeverity(group.head) === 'warning'"
                  class="shrink-0 rounded-full bg-(--tone-warning-bg) px-1.5 py-px text-[11px] font-bold text-(--tone-warning-text)"
                >{{ NOTIFICATION_SEVERITY_LABEL.warning }}</span>
                <span class="min-w-0 break-words text-sm text-(--color-text)" :class="isUnread(group) ? 'font-bold' : 'font-medium'">{{ group.head.title || notificationTypeMeta(group.head.type).label }}</span>
                <span
                  v-if="group.items.length > 1"
                  data-testid="notification-repeat"
                  class="tnum shrink-0 rounded-full bg-(--color-border-soft) px-1.5 py-px text-[11px] font-bold text-(--color-text-muted)"
                ><bdi dir="ltr" aria-hidden="true">×{{ toPersianDigits(group.items.length) }}</bdi><span class="sr-only">{{ toPersianDigits(group.items.length) }} بار</span></span>
                <template v-if="isUnread(group)">
                  <span class="ms-auto h-2 w-2 shrink-0 rounded-full bg-(--color-accent-text)" aria-hidden="true" />
                  <span class="sr-only">خوانده‌نشده</span>
                </template>
              </span>
              <span v-if="group.head.body" class="w-full break-words text-xs leading-5 text-(--color-text-muted)">{{ group.head.body }}</span>
              <span class="tnum text-xs text-(--color-text-muted)">{{ formatTime(group.head.createdAt) }}</span>
            </span>
          </button>
        </li>
      </ul>

      <div class="border-t border-(--color-border-soft) px-4 py-2">
        <RouterLink
          to="/notifications"
          data-testid="notifications-view-all"
          class="flex min-h-11 items-center justify-center rounded-lg text-sm font-semibold text-(--color-accent-text) transition-colors hover:bg-(--color-border-soft)"
          @click="open = false"
        >
          مشاهده همه اعلان‌ها
        </RouterLink>
      </div>
    </div>
  </div>
</template>
