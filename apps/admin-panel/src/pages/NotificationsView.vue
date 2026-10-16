<!-- apps/admin-panel/src/pages/NotificationsView.vue -->
<!-- The full inbox behind the header bell (which only ever shows the newest ten). Same
     grouping and severity reading as the bell, via utils/notifications.ts + labels.ts. -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useQueryFilters } from '@/composables/useQueryFilters'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import {
  NOTIFICATION_SEVERITY_LABEL,
  NOTIFICATION_TYPE_KEYS,
  notificationSeverity,
  notificationTypeMeta,
  type NotificationSeverity,
} from '@/utils/labels'
import { toPersianDigits } from '@/utils/digits'
import {
  announceNotificationsChanged,
  formatNotificationTime,
  groupNotifications,
  isGroupUnread,
  type AdminNotification,
  type NotificationGroup,
  type NotificationListResponse,
} from '@/utils/notifications'

// All three filters (read state, type, severity) are applied by the API, so `total` is the
// exact number of matching rows and every page holds only matches. The list still grows with
// «بارگذاری بیشتر» rather than paging one window at a time, so repeats of the same alert
// stay grouped across page boundaries.
const PAGE_SIZE = 50

const SEVERITY_OPTIONS = [
  { value: '', label: 'همه سطح‌ها' },
  { value: 'critical', label: NOTIFICATION_SEVERITY_LABEL.critical },
  { value: 'warning', label: NOTIFICATION_SEVERITY_LABEL.warning },
  { value: 'info', label: 'اطلاع‌رسانی و اقدام' },
]
const TYPE_OPTIONS = [
  { value: '', label: 'همه انواع' },
  ...NOTIFICATION_TYPE_KEYS.map((type) => ({ value: type, label: notificationTypeMeta(type).label })),
]

const SEVERITY_ICON_CLASS: Record<NotificationSeverity, string> = {
  critical: 'bg-(--tone-danger-bg) text-(--tone-danger-text)',
  warning: 'bg-(--tone-warning-bg) text-(--tone-warning-text)',
  action: 'bg-(--color-accent-soft) text-(--color-accent-text)',
  info: 'bg-(--color-border-soft) text-(--color-text-muted)',
}
const SEVERITY_CHIP_CLASS: Record<NotificationSeverity, string> = {
  critical: 'bg-(--tone-danger-text) text-(--color-surface-card)',
  warning: 'bg-(--tone-warning-bg) text-(--tone-warning-text)',
  action: 'bg-(--color-accent-soft) text-(--color-accent-text)',
  info: 'bg-(--tone-neutral-bg) text-(--tone-neutral-text)',
}

const router = useRouter()
const { apiFetch } = useApi()

const {
  unread: unreadFilter,
  severity: severityFilter,
  type: typeFilter,
} = useQueryFilters(
  { unread: '' as '' | 'true', severity: '' as '' | 'critical' | 'warning' | 'info', type: '' },
  { allowed: { unread: ['true'], severity: ['critical', 'warning', 'info'], type: NOTIFICATION_TYPE_KEYS } },
)

const items = ref<AdminNotification[]>([])
const total = ref(0)
const loadedPages = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref(false)
const markingAll = ref(false)
// Rows marked read here since the last fetch, while the list is filtered to unread. The
// server pages over the CURRENT unread set, so each of these drops out of it and shifts every
// later page up by one -- fetching loadedPages + 1 would silently skip that many unread rows.
let readSinceFetch = 0
// Out-of-order guard: flipping a filter quickly must not let an older response win.
let requestSeq = 0

async function fetchPage(page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
  if (unreadFilter.value === 'true') params.set('unread', 'true')
  // Severity is the API's effective severity -- the same rule as the bell and the banner's
  // unread-counts: 'info' is every non-alert row, a legacy alert with none stored is 'warning'.
  if (severityFilter.value) params.set('severity', severityFilter.value)
  if (typeFilter.value) params.set('type', typeFilter.value)
  return apiFetch<NotificationListResponse>(`/admin/notifications?${params.toString()}`, { silent: true })
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  loadError.value = false
  const { data, error } = await fetchPage(1)
  if (seq !== requestSeq) return
  loading.value = false
  if (error || !data) {
    loadError.value = true
    items.value = []
    total.value = 0
    loadedPages.value = 0
    return
  }
  items.value = data.items
  total.value = data.total
  loadedPages.value = 1
  readSinceFetch = 0
}

async function loadMore() {
  const seq = requestSeq
  loadingMore.value = true
  // Step back over the rows that left the unread set: the page holding the first row not yet
  // seen. The overlap with what is already listed is dropped by the id check below.
  const page = Math.floor((loadedPages.value * PAGE_SIZE - readSinceFetch) / PAGE_SIZE) + 1
  const { data } = await fetchPage(page)
  loadingMore.value = false
  if (seq !== requestSeq || !data) return
  // A notification created since page 1 shifts every later page by one, so the first row of
  // the next page can repeat the last row already shown -- skip ids already in the list.
  const seen = new Set(items.value.map((n) => n.id))
  items.value = [...items.value, ...data.items.filter((n) => !seen.has(n.id))]
  total.value = data.total
  loadedPages.value = page
  readSinceFetch = 0
}

const groups = computed<NotificationGroup[]>(() => groupNotifications(items.value))
// `total` counts the server's CURRENT matches. Under the unread filter, a row read here since it
// loaded is no longer one of them, so it can't count towards having reached that total.
const loadedMatches = computed(() =>
  unreadFilter.value === 'true' ? items.value.filter((n) => !n.readAt).length : items.value.length,
)
const hasMore = computed(() => loadedMatches.value < total.value)
const hasTypeOrSeverityFilter = computed(() => !!severityFilter.value || !!typeFilter.value)
const hasAnyFilter = computed(() => hasTypeOrSeverityFilter.value || unreadFilter.value === 'true')

async function markGroupRead(group: NotificationGroup): Promise<void> {
  const unread = group.items.filter((n) => !n.readAt)
  if (unread.length === 0) return
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
  if (unreadFilter.value === 'true') {
    readSinceFetch += marked
    total.value = Math.max(0, total.value - marked)
  }
  if (marked > 0) announceNotificationsChanged()
}

async function openGroup(group: NotificationGroup) {
  await markGroupRead(group)
  if (group.head.link) await router.push(group.head.link)
}

async function markAllRead() {
  markingAll.value = true
  const { error } = await apiFetch('/admin/notifications/read-all', { method: 'POST' })
  markingAll.value = false
  if (error) return
  const now = new Date().toISOString()
  for (const n of items.value) {
    if (!n.readAt && unreadFilter.value === 'true') {
      readSinceFetch++
      total.value = Math.max(0, total.value - 1)
    }
    n.readAt = n.readAt ?? now
  }
  announceNotificationsChanged()
}

function clearFilters() {
  unreadFilter.value = ''
  severityFilter.value = ''
  typeFilter.value = ''
}

const unreadOnly = computed({
  get: () => unreadFilter.value === 'true',
  set: (v: boolean) => (unreadFilter.value = v ? 'true' : ''),
})

onMounted(load)
// Every filter is server-side, so any change reloads from page 1. One watcher over all three:
// «پاک کردن فیلترها» changes them together and must cost a single request.
watch([unreadFilter, severityFilter, typeFilter], load)
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 lg:p-8">
    <AppCard :padded="false" class="p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="وضعیت خواندن" class="flex rounded-xl border border-(--color-border) bg-(--color-border-soft) p-1">
          <button
            v-for="opt in [{ v: false, label: 'همه' }, { v: true, label: 'خوانده‌نشده' }]"
            :key="String(opt.v)"
            type="button"
            role="radio"
            :aria-checked="unreadOnly === opt.v"
            :data-testid="opt.v ? 'filter-unread' : 'filter-all'"
            class="min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors"
            :class="unreadOnly === opt.v ? 'bg-(--color-surface-card) text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
            @click="unreadOnly = opt.v"
          >
            {{ opt.label }}
          </button>
        </div>
        <div data-testid="severity-filter">
          <AppSelect v-model="severityFilter" :options="SEVERITY_OPTIONS" label="سطح" width="11rem" />
        </div>
        <div data-testid="type-filter">
          <AppSelect v-model="typeFilter" :options="TYPE_OPTIONS" label="نوع" width="14rem" />
        </div>
        <AppButton v-if="hasAnyFilter" type="button" variant="ghost" data-testid="clear-filters" @click="clearFilters">
          <template #icon><AppIcon name="reset" :size="15" /></template>
          پاک کردن فیلترها
        </AppButton>
        <AppButton
          type="button"
          variant="secondary"
          class="ms-auto"
          data-testid="notifications-mark-all"
          :loading="markingAll"
          @click="markAllRead"
        >
          <template #icon><AppIcon name="check" :size="15" /></template>
          خواندن همه
        </AppButton>
      </div>
    </AppCard>

    <div v-if="loading" data-testid="notifications-loading" class="flex justify-center py-16" role="status" aria-label="در حال بارگذاری">
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="load-error"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">خطا در دریافت اعلان‌ها.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-load" @click="load">تلاش دوباره</AppButton>
    </AppCard>

    <template v-else>
      <EmptyState
        v-if="groups.length === 0"
        icon="bell"
        :message="
          hasTypeOrSeverityFilter
            ? 'اعلانی با این فیلترها وجود ندارد.'
            : unreadOnly
              ? 'اعلان خوانده‌نشده‌ای وجود ندارد.'
              : 'اعلانی وجود ندارد.'
        "
      />

      <AppCard v-else :padded="false" class="overflow-hidden">
        <ul data-testid="notifications-list">
          <li v-for="(group, i) in groups" :key="group.key" :class="i > 0 && 'border-t border-(--color-border-soft)'">
            <div
              data-testid="notification-row"
              :data-severity="notificationSeverity(group.head)"
              :data-unread="isGroupUnread(group) ? 'true' : 'false'"
              class="relative flex items-start gap-3 px-4 py-3.5 sm:px-5"
              :class="notificationSeverity(group.head) === 'critical' && isGroupUnread(group) && 'bg-(--tone-danger-bg)/40'"
            >
              <span
                v-if="notificationSeverity(group.head) === 'critical' || notificationSeverity(group.head) === 'warning'"
                class="absolute inset-y-2 start-0 w-1 rounded-full"
                :class="notificationSeverity(group.head) === 'critical' ? 'bg-(--tone-danger-text)' : 'bg-(--tone-warning-text)'"
                aria-hidden="true"
              />
              <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" :class="SEVERITY_ICON_CLASS[notificationSeverity(group.head)]">
                <AppIcon :name="notificationTypeMeta(group.head.type).icon" :size="17" />
              </span>

              <!-- The whole text block is the open-target (marks read, then follows the link);
                   the separate «خواندن» button marks read without leaving the inbox. -->
              <button type="button" data-testid="notification-open" class="flex min-w-0 flex-1 flex-col gap-1 text-start" @click="openGroup(group)">
                <span class="flex w-full min-w-0 flex-wrap items-center gap-1.5">
                  <span class="shrink-0 rounded-full px-2 py-px text-[11px] font-bold" :class="SEVERITY_CHIP_CLASS[notificationSeverity(group.head)]">
                    {{ NOTIFICATION_SEVERITY_LABEL[notificationSeverity(group.head)] }}
                  </span>
                  <span class="text-xs text-(--color-text-muted)">{{ notificationTypeMeta(group.head.type).label }}</span>
                  <span
                    v-if="group.items.length > 1"
                    data-testid="notification-repeat"
                    class="tnum shrink-0 rounded-full bg-(--color-border-soft) px-1.5 py-px text-[11px] font-bold text-(--color-text-muted)"
                  ><bdi dir="ltr" aria-hidden="true">×{{ toPersianDigits(group.items.length) }}</bdi><span class="sr-only">{{ toPersianDigits(group.items.length) }} بار</span></span>
                </span>
                <span class="break-words text-sm text-(--color-text)" :class="isGroupUnread(group) ? 'font-bold' : 'font-medium'">
                  {{ group.head.title || notificationTypeMeta(group.head.type).label }}
                </span>
                <span v-if="group.head.body" class="break-words text-xs leading-5 text-(--color-text-muted)">{{ group.head.body }}</span>
                <span class="tnum text-xs text-(--color-text-muted)">
                  {{ formatNotificationTime(group.head.createdAt) }}
                  <template v-if="group.items.length > 1"> · نخستین: {{ formatNotificationTime(group.items[group.items.length - 1]!.createdAt) }}</template>
                </span>
              </button>

              <div class="flex shrink-0 items-center gap-1">
                <template v-if="isGroupUnread(group)">
                  <span class="h-2 w-2 rounded-full bg-(--color-accent-text)" aria-hidden="true" />
                  <AppButton
                    type="button"
                    variant="ghost"
                    data-testid="notification-mark-read"
                    :aria-label="`علامت‌گذاری به‌عنوان خوانده‌شده: ${group.head.title || notificationTypeMeta(group.head.type).label}`"
                    class="min-w-11 px-2.5! sm:px-4!"
                    @click="markGroupRead(group)"
                  >
                    <!-- Icon-only on phones, where the text column needs every pixel. -->
                    <template #icon><AppIcon name="check" :size="16" /></template>
                    <span class="hidden sm:inline">خواندن</span>
                  </AppButton>
                </template>
                <span v-else class="hidden px-2 text-xs text-(--color-text-muted) sm:inline">خوانده‌شده</span>
              </div>
            </div>
          </li>
        </ul>
      </AppCard>

      <div v-if="items.length > 0" class="flex flex-wrap items-center justify-between gap-3">
        <p class="tnum text-xs text-(--color-text-muted)" data-testid="notifications-loaded-count">
          {{ loadedMatches.toLocaleString('fa-IR') }} از {{ total.toLocaleString('fa-IR') }} اعلان بارگذاری شده
        </p>
        <AppButton
          v-if="hasMore"
          type="button"
          variant="secondary"
          data-testid="notifications-load-more"
          :loading="loadingMore"
          @click="loadMore"
        >
          بارگذاری بیشتر
        </AppButton>
      </div>
    </template>
  </div>
</template>
