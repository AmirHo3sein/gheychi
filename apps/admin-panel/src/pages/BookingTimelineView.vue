<!-- apps/admin-panel/src/pages/BookingTimelineView.vue -->
<!-- The support timeline for one booking: every lifecycle moment the backend recorded,
     oldest first. Read-only by construction -- there is no admin route that mutates a
     booking, and this page must not imply otherwise.

     Deliberately NOT reachable from the sidebar: it is addressed by booking id, so it is a
     deep-link/escalation target (paste an id from a support ticket), not a browsable list. -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { formatToman } from '@/utils/format-toman'
import {
  type Tone,
  bookingConfirmationModeLabel,
  bookingEventActorTypeLabel,
  bookingEventCauseLabel,
  bookingEventMetadataKeyLabel,
  bookingEventTypeLabel,
  bookingStatusLabel,
} from '@/utils/labels'

interface BookingEventRow {
  id: string
  bookingId: string
  eventType: string
  actorType: string
  // Null for every `system` (cron-driven) event, and for any actor that isn't a users row.
  actorId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

// Purely presentational -- an unmapped event type still renders (with the neutral fallback
// glyph and its raw name from the label map), it just looks less specific.
const EVENT_ICON: Record<string, IconName> = {
  BOOKING_CREATED: 'calendar',
  APPROVAL_REQUESTED: 'bell',
  SALON_APPROVED: 'check',
  SALON_REJECTED: 'x',
  APPROVAL_EXPIRED: 'history',
  PAYMENT_WINDOW_STARTED: 'history',
  PAYMENT_INITIATED: 'wallet',
  PAYMENT_SUCCEEDED: 'check',
  PAYMENT_FAILED: 'warning',
  PAYMENT_EXPIRED: 'history',
  BOOKING_CONFIRMED: 'check',
  SLOT_RELEASED: 'reset',
  BOOKING_CANCELLED: 'x',
  BOOKING_COMPLETED: 'check',
  BOOKING_NO_SHOW: 'warning',
}

// Same token pairs StatusBadge uses, applied to the rail node instead of a pill -- the
// timeline's dots are the only at-a-glance cue for how a booking went.
const TONE_NODE_CLASSES: Record<Tone, string> = {
  success: 'bg-(--tone-success-bg) text-(--tone-success-text)',
  warning: 'bg-(--tone-warning-bg) text-(--tone-warning-text)',
  danger: 'bg-(--tone-danger-bg) text-(--tone-danger-text)',
  neutral: 'bg-(--tone-neutral-bg) text-(--tone-neutral-text)',
  info: 'bg-(--tone-info-bg) text-(--tone-info-text)',
}

// Toman-denominated metadata keys -- everything else numeric is a plain count/duration.
const MONEY_KEYS = new Set(['depositAmount', 'refundOwed'])

const route = useRoute()
const { apiFetch } = useApi()
const events = ref<BookingEventRow[]>([])
const loading = ref(true)
// Distinct from "no events": a failed fetch repainted as an empty timeline would read as
// "nothing ever happened to this booking", which is exactly the wrong conclusion for the
// support case this page exists to serve.
const loadError = ref(false)

const bookingId = String(route.params.id)

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<BookingEventRow[]>(`/admin/bookings/${bookingId}/events`, { silent: true })
  if (error || !data) {
    loadError.value = true
    events.value = []
    loading.value = false
    return
  }
  // The backend already returns these oldest-first; nothing is re-sorted client-side, so
  // two events sharing a timestamp keep the order the backend recorded them in.
  events.value = data
  loading.value = false
}

function eventIcon(eventType: string): IconName {
  return EVENT_ICON[eventType] ?? 'history'
}

// Seconds included on purpose: several transitions (approve → payment window opens, reject
// → slot released) are recorded in the same second-or-two, and minute precision would make
// their order look arbitrary.
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso))
}

/**
 * metadata is free-form jsonb, so this is a best-effort prettifier: known keys get their
 * natural rendering (a deadline as a date, minutes as a duration, an enum through its own
 * label map) and anything unrecognised is still shown rather than dropped.
 */
function formatMetadataValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (key === 'confirmationMode') return bookingConfirmationModeLabel(String(value)).label
  if (key === 'fromStatus') return bookingStatusLabel(String(value)).label
  // `cause` is always an enum; `reason` is usually the salon's own free text, but
  // BOOKING_CONFIRMED writes the enum-ish 'zero_deposit' under it. The map falls back to
  // the raw string, so free text passes through untouched either way.
  if (key === 'cause' || key === 'reason') return bookingEventCauseLabel(String(value))
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر'
  if (typeof value === 'number') {
    if (MONEY_KEYS.has(key)) return `${formatToman(value)} تومان`
    if (key.endsWith('Minutes')) return `${value.toLocaleString('fa-IR')} دقیقه`
    return value.toLocaleString('fa-IR')
  }
  if (typeof value === 'string') {
    // A deadline snapshot (approvalExpiresAt / paymentExpiresAt) arrives as an ISO string.
    if (key.endsWith('At')) {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) return formatDateTime(value)
    }
    return value
  }
  return JSON.stringify(value)
}

function metadataEntries(metadata: Record<string, unknown> | null): { key: string; label: string; text: string }[] {
  if (!metadata) return []
  return Object.entries(metadata).map(([key, value]) => ({
    key,
    label: bookingEventMetadataKeyLabel(key),
    text: formatMetadataValue(key, value),
  }))
}

onMounted(load)
</script>

<!-- p-8 from `sm` up; below that 64px of gutter is a fifth of a 320px screen. -->
<template>
  <div class="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
    <AppCard>
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)">
          <AppIcon name="history" :size="22" />
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-(--color-text)">تاریخچه رزرو</h2>
          <!-- dir="ltr" + break-all: a UUID has no break opportunity and would otherwise
               widen the card on a narrow viewport. -->
          <p dir="ltr" class="tnum mt-0.5 break-all text-right text-xs text-(--color-text-muted)">{{ bookingId }}</p>
        </div>
      </div>
    </AppCard>

    <div
      v-if="loading"
      data-testid="timeline-loading"
      role="status"
      aria-label="در حال بارگذاری"
      class="flex h-40 items-center justify-center"
    >
      <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-text-muted)" />
    </div>

    <AppCard
      v-else-if="loadError"
      :padded="false"
      data-testid="timeline-error"
      role="alert"
      class="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center"
    >
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--tone-danger-bg) text-(--tone-danger-text)">
        <AppIcon name="warning" :size="22" />
      </div>
      <p class="text-sm text-(--color-text-muted)">بارگذاری تاریخچه این رزرو با خطا مواجه شد.</p>
      <AppButton type="button" variant="secondary" data-testid="timeline-retry" @click="load">
        <template #icon><AppIcon name="reset" :size="15" /></template>
        تلاش مجدد
      </AppButton>
    </AppCard>

    <!-- Every real booking has at least a BOOKING_CREATED event, so an empty list in
         practice means the id doesn't match a booking -- the copy says so instead of
         implying a booking exists but did nothing. -->
    <EmptyState
      v-else-if="events.length === 0"
      icon="history"
      message="رویدادی برای این رزرو ثبت نشده است؛ شناسه رزرو را بررسی کنید."
    />

    <AppCard v-else>
      <ol class="space-y-0">
        <li v-for="(event, i) in events" :key="event.id" data-testid="timeline-event" class="flex gap-4">
          <!-- The rail is a flex column, not an absolutely-positioned line: the connector
               stretches with flex-1, which keeps it correct at any row height and in RTL
               without any directional offsets to get wrong. -->
          <div class="flex w-9 shrink-0 flex-col items-center">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              :class="TONE_NODE_CLASSES[bookingEventTypeLabel(event.eventType).tone]"
            >
              <AppIcon :name="eventIcon(event.eventType)" :size="17" />
            </span>
            <span v-if="i < events.length - 1" class="w-px flex-1 bg-(--color-border)" />
          </div>

          <div class="min-w-0 flex-1" :class="i < events.length - 1 && 'pb-6'">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusBadge
                :label="bookingEventTypeLabel(event.eventType).label"
                :tone="bookingEventTypeLabel(event.eventType).tone"
              />
              <span class="tnum text-xs text-(--color-text-muted)">{{ formatDateTime(event.createdAt) }}</span>
            </div>

            <p class="mt-1.5 text-xs text-(--color-text-muted)">
              عامل: <span class="font-semibold text-(--color-text)">{{ bookingEventActorTypeLabel(event.actorType) }}</span>
            </p>
            <!-- Shown in full, not truncated: this id is what a support agent pastes into
                 the users search, so a shortened prefix would defeat the purpose. -->
            <p v-if="event.actorId" data-testid="event-actor-id" dir="ltr" class="tnum break-all text-right text-xs text-(--color-text-muted)">
              {{ event.actorId }}
            </p>

            <dl
              v-if="metadataEntries(event.metadata).length > 0"
              data-testid="event-metadata"
              class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-(--color-border-soft) p-3 text-xs"
            >
              <!-- Text interpolation only (never v-html) -- metadata carries user-supplied
                   text such as a salon's rejection reason. -->
              <template v-for="entry in metadataEntries(event.metadata)" :key="entry.key">
                <dt class="text-(--color-text-muted)">{{ entry.label }}</dt>
                <dd class="tnum min-w-0 break-words font-semibold text-(--color-text)">{{ entry.text }}</dd>
              </template>
            </dl>
          </div>
        </li>
      </ol>
    </AppCard>
  </div>
</template>
