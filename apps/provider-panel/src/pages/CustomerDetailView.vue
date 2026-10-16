<!-- apps/provider-panel/src/pages/CustomerDetailView.vue -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { bookingStatusLabel } from '@/utils/labels'
import { formatToman } from '@/utils/format-toman'
import { formatNumber, toPersianDigits } from '@/utils/digits'

interface CustomerBooking { id: string; startsAt: string; status: string; priceSnapshot: number; serviceName: string | null }
interface CustomerNote { id: string; note: string; createdAt: string }
interface CustomerDetail {
  customer: { id: string; name: string | null; phone: string }
  bookings: CustomerBooking[]
  notes: CustomerNote[]
}
interface SmsQuota { quota: number; used: number; remaining: number }

const route = useRoute()
const customerId = route.params.id as string
const { apiFetch } = useApi()
const { push: pushToast } = useToast()

const detail = ref<CustomerDetail | null>(null)
const loading = ref(true)
const loadError = ref(false)
const notFound = ref(false)
const quota = ref<SmsQuota | null>(null)

async function load() {
  loading.value = true
  loadError.value = false
  notFound.value = false
  const { data, error } = await apiFetch<CustomerDetail>(`/salons/mine/customers/${customerId}`, {
    silent: true,
    redirectOn401: false,
  })
  loading.value = false
  if (data) {
    detail.value = data
    return
  }
  if (error?.status === 404) {
    notFound.value = true
    return
  }
  loadError.value = true
}

async function loadQuota() {
  // Silent + independent of load() -- a failure here shouldn't block the rest of the page,
  // it just means the remaining-count line doesn't render; the send endpoint itself still
  // enforces the real limit either way.
  const { data } = await apiFetch<SmsQuota>('/salons/mine/sms-quota', { silent: true })
  quota.value = data
}

// `?compose=sms` (the customers page's lapsed-customer «پیامک» link) lands with the
// single-SMS composer focused -- still one message to one customer, sent from here.
const smsInput = ref<HTMLTextAreaElement | null>(null)
onMounted(async () => {
  loadQuota()
  await load()
  if (route.query.compose === 'sms' && detail.value) {
    await nextTick()
    smsInput.value?.scrollIntoView?.({ block: 'center' })
    smsInput.value?.focus()
  }
})

// CustomerSmsService accepts 1-500 characters; mirrored here so the limit is visible.
const SMS_MAX_LENGTH = 500
const quotaExhausted = computed(() => quota.value !== null && quota.value.remaining <= 0)

const smsMessage = ref('')
const sendingSms = ref(false)
async function sendSms() {
  if (!smsMessage.value.trim() || quotaExhausted.value) return
  sendingSms.value = true
  const { data } = await apiFetch<SmsQuota>(`/salons/mine/customers/${customerId}/sms`, {
    method: 'POST',
    body: { message: smsMessage.value.trim() },
  })
  sendingSms.value = false
  if (data) {
    quota.value = data
    smsMessage.value = ''
    pushToast('پیامک ارسال شد', 'success')
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

const newNote = ref('')
const submitting = ref(false)
async function addNote() {
  if (!newNote.value.trim()) return
  submitting.value = true
  const { data } = await apiFetch<CustomerNote>(`/salons/mine/customers/${customerId}/notes`, {
    method: 'POST',
    body: { note: newNote.value.trim() },
  })
  submitting.value = false
  if (data && detail.value) {
    detail.value.notes.unshift(data)
    newNote.value = ''
  }
}

async function removeNote(noteId: string) {
  const { error } = await apiFetch(`/salons/mine/customers/${customerId}/notes/${noteId}`, { method: 'DELETE' })
  if (!error && detail.value) {
    detail.value.notes = detail.value.notes.filter((n) => n.id !== noteId)
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <RouterLink to="/customers" class="inline-flex min-h-11 items-center gap-1 text-sm text-(--color-accent-text) hover:underline">
      <AppIcon name="chevron-right" :size="16" />
      همه مشتریان
    </RouterLink>

    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <EmptyState v-else-if="notFound" icon="customers" message="این مشتری برای سالن شما یافت نشد." />

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات مشتری بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-customer-detail" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else-if="detail">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent-text)">
          <AppIcon name="customers" :size="22" />
        </div>
        <div class="min-w-0 flex-1">
          <h1 class="break-words text-lg font-bold text-(--color-text)">{{ detail.customer.name || 'بدون نام' }}</h1>
          <p dir="ltr" class="tnum text-end text-sm text-(--color-text-muted)">{{ toPersianDigits(detail.customer.phone) }}</p>
        </div>
        <a
          :href="`tel:${detail.customer.phone}`"
          data-testid="customer-call"
          class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-(--color-border-control) px-4 text-sm font-semibold text-(--color-text) hover:bg-(--color-surface-subtle)"
        >
          <AppIcon name="phone" :size="16" />
          تماس
        </a>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section class="min-w-0 space-y-2" aria-labelledby="customer-bookings-title">
          <h2 id="customer-bookings-title" class="text-base font-bold text-(--color-text)">
            تاریخچه نوبت‌ها
            <span class="tnum text-sm font-normal text-(--color-text-muted)">({{ formatNumber(detail.bookings.length) }})</span>
          </h2>
          <EmptyState v-if="detail.bookings.length === 0" compact icon="bookings" message="هنوز نوبتی برای این مشتری ثبت نشده است." />
          <AppCard v-for="b in detail.bookings" :key="b.id" data-testid="customer-booking-row" :padded="false" class="p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="break-words text-sm font-semibold text-(--color-text)">{{ b.serviceName || 'خدمت حذف‌شده' }}</p>
                <p class="tnum text-xs text-(--color-text-muted)">{{ formatDate(b.startsAt) }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span class="tnum text-sm text-(--color-text-muted)">{{ formatToman(b.priceSnapshot) }} تومان</span>
                <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" />
              </div>
            </div>
          </AppCard>
        </section>

        <div class="min-w-0 space-y-4">
          <AppCard>
            <h2 class="mb-1 text-base font-bold text-(--color-text)">ارسال پیامک به این مشتری</h2>
            <p class="mb-2 text-xs leading-5 text-(--color-text-muted)">یک پیام شخصی برای همین مشتری؛ نام سالن به ابتدای پیام افزوده می‌شود.</p>
            <p v-if="quota" data-testid="sms-quota-remaining" class="mb-2 text-xs text-(--color-text-muted)">
              <span class="tnum">{{ formatNumber(quota.remaining) }}</span> از <span class="tnum">{{ formatNumber(quota.quota) }}</span> پیامک این ماه برای سالن شما باقی مانده است.
            </p>
            <label for="customer-sms-message" class="sr-only">متن پیامک</label>
            <textarea
              id="customer-sms-message"
              ref="smsInput"
              v-model="smsMessage"
              data-testid="sms-message-input"
              rows="3"
              :maxlength="SMS_MAX_LENGTH"
              :disabled="quotaExhausted"
              placeholder="متنی برای این مشتری بنویسید…"
              class="w-full rounded-xl border border-(--color-border-control) bg-(--color-surface-card) p-3 text-sm disabled:opacity-60"
            />
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
              <AppButton
                type="button"
                variant="secondary"
                data-testid="send-sms-button"
                :loading="sendingSms"
                :disabled="sendingSms || !smsMessage.trim() || quotaExhausted"
                @click="sendSms"
              >
                ارسال پیامک
              </AppButton>
              <span class="tnum text-xs text-(--color-text-muted)" aria-hidden="true">
                {{ formatNumber(smsMessage.length) }} / {{ formatNumber(SMS_MAX_LENGTH) }}
              </span>
            </div>
            <p v-if="quotaExhausted" data-testid="sms-quota-exhausted" class="mt-2 text-xs text-(--tone-warning-text)">
              سهمیهٔ پیامک این ماه تمام شده است.
            </p>
          </AppCard>

          <AppCard>
            <h2 class="mb-1 text-base font-bold text-(--color-text)">یادداشت‌های خصوصی</h2>
            <p class="mb-2 text-xs text-(--color-text-muted)">این یادداشت‌ها فقط برای شما قابل مشاهده است.</p>
            <label for="customer-new-note" class="sr-only">یادداشت جدید</label>
            <textarea
              id="customer-new-note"
              v-model="newNote"
              data-testid="new-note-input"
              rows="2"
              placeholder="یادداشتی درباره این مشتری بنویسید…"
              class="w-full rounded-xl border border-(--color-border-control) bg-(--color-surface-card) p-3 text-sm"
            />
            <AppButton type="button" variant="secondary" class="mt-2" data-testid="add-note-button" :disabled="submitting || !newNote.trim()" @click="addNote">
              افزودن یادداشت
            </AppButton>

            <ul v-if="detail.notes.length" class="mt-3 space-y-2">
              <li
                v-for="n in detail.notes"
                :key="n.id"
                data-testid="note-row"
                class="flex items-start justify-between gap-3 rounded-xl bg-(--color-surface-subtle) p-3"
              >
                <div class="min-w-0">
                  <p class="break-words text-sm text-(--color-text)">{{ n.note }}</p>
                  <p class="tnum mt-1 text-xs text-(--color-text-muted)">{{ formatDate(n.createdAt) }}</p>
                </div>
                <AppButton type="button" variant="ghost" aria-label="حذف یادداشت" :data-testid="`delete-note-${n.id}`" @click="removeNote(n.id)">
                  <template #icon><AppIcon name="trash" :size="15" /></template>
                </AppButton>
              </li>
            </ul>
          </AppCard>
        </div>
      </div>
    </template>
  </div>
</template>
