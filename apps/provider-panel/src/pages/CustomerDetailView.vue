<!-- apps/provider-panel/src/pages/CustomerDetailView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { bookingStatusLabel } from '@/utils/labels'
import { formatToman } from '@/utils/format-toman'

interface CustomerBooking { id: string; startsAt: string; status: string; priceSnapshot: number; serviceName: string | null }
interface CustomerNote { id: string; note: string; createdAt: string }
interface CustomerDetail {
  customer: { id: string; name: string | null; phone: string }
  bookings: CustomerBooking[]
  notes: CustomerNote[]
}

const route = useRoute()
const customerId = route.params.id as string
const { apiFetch } = useApi()

const detail = ref<CustomerDetail | null>(null)
const loading = ref(true)
const loadError = ref(false)
const notFound = ref(false)

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
onMounted(load)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
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
  <div class="mx-auto w-full max-w-2xl space-y-4 p-4 lg:p-6">
    <div v-if="loading" class="flex items-center justify-center py-14 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <EmptyState v-else-if="notFound" icon="customers" message="این مشتری برای سالن شما یافت نشد." />

    <div v-else-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات مشتری بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-customer-detail" @click="load">تلاش دوباره</AppButton>
    </div>

    <template v-else-if="detail">
      <div class="flex items-center gap-3">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-(--color-border-soft) text-(--color-accent-text)">
          <AppIcon name="customers" :size="20" />
        </div>
        <div class="min-w-0">
          <h1 class="break-words text-lg font-bold text-(--color-text)">{{ detail.customer.name || 'بدون نام' }}</h1>
          <p dir="ltr" class="tnum text-sm text-(--color-text-muted)">{{ detail.customer.phone }}</p>
        </div>
      </div>

      <div>
        <h2 class="mb-2 text-base font-bold text-(--color-text)">تاریخچه نوبت‌ها</h2>
        <div class="space-y-2">
          <AppCard v-for="b in detail.bookings" :key="b.id" data-testid="customer-booking-row" :padded="false" class="p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="break-words text-sm font-semibold text-(--color-text)">{{ b.serviceName || 'خدمت حذف‌شده' }}</p>
                <p class="tnum text-xs text-(--color-text-muted)">{{ formatDate(b.startsAt) }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span dir="ltr" class="tnum text-sm text-(--color-text-muted)">{{ formatToman(b.priceSnapshot) }} تومان</span>
                <StatusBadge :label="bookingStatusLabel(b.status).label" :tone="bookingStatusLabel(b.status).tone" />
              </div>
            </div>
          </AppCard>
        </div>
      </div>

      <div>
        <h2 class="mb-2 text-base font-bold text-(--color-text)">یادداشت‌های خصوصی</h2>
        <p class="mb-2 text-xs text-(--color-text-muted)">این یادداشت‌ها فقط برای شما قابل مشاهده است.</p>
        <div class="mb-3 flex gap-2">
          <textarea
            v-model="newNote"
            data-testid="new-note-input"
            rows="2"
            placeholder="یادداشتی درباره این مشتری بنویسید…"
            class="w-full rounded-xl border border-(--color-text-muted) p-3 text-sm"
          />
        </div>
        <AppButton type="button" variant="secondary" data-testid="add-note-button" :disabled="submitting || !newNote.trim()" @click="addNote">
          افزودن یادداشت
        </AppButton>

        <div class="mt-4 space-y-2">
          <AppCard v-for="n in detail.notes" :key="n.id" data-testid="note-row" :padded="false" class="p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="break-words text-sm text-(--color-text)">{{ n.note }}</p>
                <p class="tnum mt-1 text-xs text-(--color-text-muted)">{{ formatDate(n.createdAt) }}</p>
              </div>
              <AppButton type="button" variant="ghost" :data-testid="`delete-note-${n.id}`" @click="removeNote(n.id)">
                <template #icon><AppIcon name="trash" :size="15" /></template>
              </AppButton>
            </div>
          </AppCard>
        </div>
      </div>
    </template>
  </div>
</template>
