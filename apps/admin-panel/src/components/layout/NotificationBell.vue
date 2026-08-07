<!-- apps/admin-panel/src/components/layout/NotificationBell.vue -->
<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

interface AdminNotification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationListResponse {
  items: AdminNotification[]
  total: number
  page: number
  pageSize: number
}

const POLL_INTERVAL_MS = 60_000

const router = useRouter()
const { apiFetch } = useApi()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const count = ref(0)
const notifications = ref<AdminNotification[]>([])
const loadingList = ref(false)

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

async function openNotification(notification: AdminNotification) {
  if (!notification.readAt) {
    const { error } = await apiFetch(`/admin/notifications/${notification.id}/read`, {
      method: 'PATCH',
      silent: true,
    })
    if (!error) {
      notification.readAt = new Date().toISOString()
      count.value = Math.max(0, count.value - 1)
    }
  }
  open.value = false
  if (notification.link) await router.push(notification.link)
}

async function markAllRead() {
  const { error } = await apiFetch('/admin/notifications/read-all', { method: 'POST', silent: true })
  if (!error) {
    count.value = 0
    const now = new Date().toISOString()
    for (const notification of notifications.value) notification.readAt = notification.readAt ?? now
  }
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function onDocumentClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => {
  loadCount()
  pollTimer = setInterval(loadCount, POLL_INTERVAL_MS)
  document.addEventListener('mousedown', onDocumentClick)
  window.addEventListener('resize', keepPanelOnScreen)
})

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  document.removeEventListener('mousedown', onDocumentClick)
  window.removeEventListener('resize', keepPanelOnScreen)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      data-testid="notification-bell"
      type="button"
      title="اعلان‌ها"
      class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
      @click="toggle"
    >
      <AppIcon name="bell" :size="18" />
      <span
        v-if="count > 0"
        data-testid="unread-badge"
        class="tnum absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--color-danger-strong) px-1 text-[10px] font-bold text-(--color-fill-text)"
      >
        {{ count > 99 ? '۹۹+' : count }}
      </span>
    </button>

    <!-- max-width keeps the panel itself from ever being wider than the viewport; the
         measured `panelShiftX` above keeps it from being *positioned* outside it. -->
    <div
      v-if="open"
      ref="panel"
      data-testid="notification-dropdown"
      class="absolute end-0 z-50 mt-1.5 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-md)"
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

      <ul v-else class="max-h-96 overflow-y-auto py-1">
        <li v-for="notification in notifications" :key="notification.id">
          <button
            type="button"
            data-testid="notification-item"
            class="flex w-full flex-col gap-0.5 px-4 py-2.5 text-right transition-colors hover:bg-(--color-border-soft)"
            @click="openNotification(notification)"
          >
            <!-- Titles/bodies are server-composed strings that can carry a salon name or an
                 id with no break opportunity -- `break-words` keeps one from widening the
                 panel past the clamp above. -->
            <span class="flex w-full min-w-0 items-center gap-2">
              <span v-if="!notification.readAt" class="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-accent)" />
              <span class="min-w-0 break-words text-sm font-semibold text-(--color-text)">{{ notification.title }}</span>
            </span>
            <span v-if="notification.body" class="w-full break-words text-xs leading-5 text-(--color-text-muted)">{{ notification.body }}</span>
            <span class="tnum text-[11px] text-(--color-text-muted)">{{ formatTime(notification.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
