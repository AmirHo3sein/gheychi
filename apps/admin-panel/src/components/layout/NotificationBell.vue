<!-- apps/admin-panel/src/components/layout/NotificationBell.vue -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
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

async function toggle() {
  open.value = !open.value
  if (open.value) await loadList()
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
})

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer)
  document.removeEventListener('mousedown', onDocumentClick)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      data-testid="notification-bell"
      type="button"
      title="اعلان‌ها"
      class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
      @click="toggle"
    >
      <AppIcon name="bell" :size="18" />
      <span
        v-if="count > 0"
        data-testid="unread-badge"
        class="tnum absolute -left-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--tone-danger-text) px-1 text-[10px] font-bold text-white"
      >
        {{ count > 99 ? '۹۹+' : count }}
      </span>
    </button>

    <div
      v-if="open"
      data-testid="notification-dropdown"
      class="absolute left-0 z-50 mt-1.5 w-80 rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-pop)"
    >
      <div class="flex items-center justify-between border-b border-(--color-border-soft) px-4 py-2.5">
        <p class="text-sm font-bold text-(--color-text)">اعلان‌ها</p>
        <button
          data-testid="mark-all-read"
          type="button"
          class="text-xs font-semibold text-(--color-accent) transition-opacity hover:opacity-80"
          @click="markAllRead"
        >
          خواندن همه
        </button>
      </div>

      <p v-if="!loadingList && notifications.length === 0" class="px-4 py-8 text-center text-sm text-(--color-muted)">
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
            <span class="flex items-center gap-2">
              <span v-if="!notification.readAt" class="h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-accent)" />
              <span class="text-sm font-semibold text-(--color-text)">{{ notification.title }}</span>
            </span>
            <span v-if="notification.body" class="text-xs leading-5 text-(--color-muted)">{{ notification.body }}</span>
            <span class="tnum text-[11px] text-(--color-muted)">{{ formatTime(notification.createdAt) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
