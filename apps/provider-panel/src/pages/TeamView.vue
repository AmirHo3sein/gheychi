<!-- apps/provider-panel/src/pages/TeamView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMultiSelect from '@/components/ui/AppMultiSelect.vue'
import type { SelectOption } from '@/components/ui/AppSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { toEnglishDigits } from '@/utils/digits'

interface Worker {
  id: string
  name: string
  active: boolean
  // numeric(3,2) column -- comes back as a string, same as salon.ratingAvg elsewhere.
  ratingAvg: string
  ratingCount: number
  createdAt: string
  // Empty means unrestricted -- eligible for every one of the salon's services. See
  // worker-service.entity.ts on the API side for the full semantics.
  serviceIds: string[]
}

interface SalonServiceOption {
  id: string
  name: string
}

interface ReferralCode {
  code: string
  isActive: boolean
  shareUrl: string
}

interface ScheduleException {
  id: string
  date: string
  // null means a whole-salon closure (HoursView.vue's own feature) -- never shown here,
  // this page only ever renders/creates rows where this is set.
  workerId: string | null
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const workers = ref<Worker[]>([])
const loading = ref(true)
// A fetch failure must not be silently repainted as an empty state -- see
// ServicesView.vue's identical loadError pattern.
const loadError = ref(false)
const createError = ref('')
const newWorker = reactive({ name: '', phone: '' })

const salonServices = ref<SalonServiceOption[]>([])
const serviceOptions = computed<SelectOption[]>(() => salonServices.value.map((s) => ({ value: s.id, label: s.name })))
// Per-worker save-in-flight flag, keyed by worker id -- mirrors the referral-code
// state pattern above (separate reactive record, not a field on Worker).
const savingServices = reactive<Record<string, boolean>>({})

// Per-worker referral-code reveal state, keyed by worker id. Kept separate from the
// Worker list itself (rather than a field on Worker) since the code is fetched lazily,
// one owner-relay lookup at a time, not as part of the initial list load.
const referralRevealed = reactive<Record<string, boolean>>({})
const referralLoading = reactive<Record<string, boolean>>({})
const referralError = reactive<Record<string, string>>({})
const referralCodes = reactive<Record<string, ReferralCode>>({})

// One shared fetch of every exception (whole-salon AND per-worker), grouped client-side --
// same idiom as BookingsView.vue's day view, cheaper than one request per worker card.
const exceptions = ref<ScheduleException[]>([])
const workerOffDraft = reactive<Record<string, string>>({})
const workerOffSaving = reactive<Record<string, boolean>>({})

async function load() {
  loading.value = true
  loadError.value = false
  const [workersRes, servicesRes, exceptionsRes] = await Promise.all([
    apiFetch<Worker[]>('/salons/mine/workers', { silent: true }),
    apiFetch<SalonServiceOption[]>('/salons/mine/services', { silent: true }),
    apiFetch<ScheduleException[]>('/salons/mine/exceptions', { silent: true }),
  ])
  if (workersRes.error || servicesRes.error || exceptionsRes.error) {
    loadError.value = true
    loading.value = false
    return
  }
  workers.value = workersRes.data ?? []
  salonServices.value = servicesRes.data ?? []
  exceptions.value = exceptionsRes.data ?? []
  // JalaliDatePicker's modelValue is a required prop -- seeding an empty draft entry per
  // worker up front means it never receives undefined, just an unset ''.
  for (const w of workers.value) workerOffDraft[w.id] = workerOffDraft[w.id] ?? ''
  loading.value = false
}

// Every day off for one worker, soonest first -- deliberately NOT filtered to upcoming-only
// (unlike BookingsView.vue's day view): the date picker doesn't stop an owner from picking a
// past date by mistake, and nothing here validates that server-side either (matching
// HoursView.vue's own whole-salon exceptions list, which is equally unfiltered) -- silently
// hiding a just-created row because it happened to land in the past would look like the
// "add" button did nothing at all.
function workerOffDays(workerId: string): ScheduleException[] {
  return exceptions.value
    .filter((e) => e.workerId === workerId)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function offDayLabel(e: ScheduleException): string {
  return new Date(`${e.date}T12:00:00Z`).toLocaleDateString('fa-IR')
}

async function addWorkerOffDay(worker: Worker) {
  const date = workerOffDraft[worker.id]
  if (!date) return
  workerOffSaving[worker.id] = true
  const { data, error } = await apiFetch<ScheduleException>('/salons/mine/exceptions', {
    method: 'POST',
    body: { date, workerId: worker.id },
  })
  workerOffSaving[worker.id] = false
  if (error) return
  if (data) exceptions.value.push(data)
  workerOffDraft[worker.id] = ''
}

async function removeWorkerOffDay(id: string) {
  if (!window.confirm('این روز مرخصی حذف شود؟')) return
  const { error } = await apiFetch(`/salons/mine/exceptions/${id}`, { method: 'DELETE' })
  if (error) return
  exceptions.value = exceptions.value.filter((e) => e.id !== id)
}

onMounted(load)

async function updateWorkerServices(worker: Worker, serviceIds: Array<string | number>) {
  const ids = serviceIds.map(String)
  savingServices[worker.id] = true
  const { data, error } = await apiFetch<{ id: string; serviceIds: string[] }>(
    `/salons/mine/workers/${worker.id}/services`,
    { method: 'PATCH', body: { serviceIds: ids } },
  )
  savingServices[worker.id] = false
  if (data) {
    worker.serviceIds = data.serviceIds
  }
  // On error, useApi's own toast already surfaced the failure; the multiselect's
  // v-model reverts on the next render since worker.serviceIds was never mutated.
}

function ratingText(w: Worker): string {
  if (w.ratingCount === 0) return 'بدون امتیاز'
  const rating = Number(w.ratingAvg).toLocaleString('fa-IR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return `${rating} (${w.ratingCount.toLocaleString('fa-IR')} نظر)`
}

async function addWorker() {
  createError.value = ''
  if (!newWorker.name.trim() || !newWorker.phone.trim()) {
    createError.value = 'نام و شماره موبایل الزامی است'
    return
  }

  // Not silent: a 409 (duplicate worker) or 400 (self-hire/validation) both need to surface
  // inline, not just via the generic toast -- the toast still fires too (useApi's default
  // non-silent behavior). Non-409 errors are mapped to a fixed Persian message rather than
  // trusting the server string verbatim -- class-validator's DTO messages (e.g. the phone
  // format check) are English and would otherwise leak untranslated onto this Persian-only
  // screen. Mirrors LoginView.vue's pattern.
  const { data, error } = await apiFetch<Worker>('/salons/mine/workers', {
    method: 'POST',
    // Iranian keyboards/IMEs commonly default to Persian numerals -- a phone typed that way
    // looks right on screen but fails the API's /^09\d{9}$/ check, since \d is ASCII-only.
    body: { name: newWorker.name.trim(), phone: toEnglishDigits(newWorker.phone.trim()) },
  })
  if (error) {
    createError.value = error.status === 409
      ? 'این کاربر از قبل عضو تیم است.'
      : 'اطلاعات وارد شده نامعتبر است. لطفاً نام و شماره موبایل را بررسی کنید.'
    return
  }
  if (data) {
    workers.value.unshift(data)
    workerOffDraft[data.id] = ''
  }

  newWorker.name = ''
  newWorker.phone = ''
}

async function toggleActive(worker: Worker, event: Event) {
  const active = (event.target as HTMLInputElement).checked
  const { data } = await apiFetch<Worker>(`/salons/mine/workers/${worker.id}`, { method: 'PATCH', body: { active } })
  if (data) {
    worker.active = data.active
  } else {
    // Revert the checkbox's DOM state -- the PATCH failed, worker.active didn't change.
    ;(event.target as HTMLInputElement).checked = worker.active
  }
}

// Show/hide the inline reveal panel; fetches the code at most once per worker per
// mount (the code is a lifetime, never-reissued value -- no need to refetch on re-reveal).
async function toggleReferralCode(worker: Worker) {
  if (referralRevealed[worker.id]) {
    referralRevealed[worker.id] = false
    return
  }
  referralRevealed[worker.id] = true
  if (referralCodes[worker.id] || referralLoading[worker.id]) return

  referralLoading[worker.id] = true
  delete referralError[worker.id]
  const { data, error } = await apiFetch<ReferralCode>(`/salons/mine/workers/${worker.id}/referral-code`, { silent: true })
  referralLoading[worker.id] = false
  if (data) {
    referralCodes[worker.id] = data
  } else {
    referralError[worker.id] = error?.message ?? 'خطا در دریافت کد معرفی'
  }
}

async function copyReferralCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    pushToast('کد در کلیپ‌بورد کپی شد.')
  } catch {
    pushToast('کپی کد ناموفق بود.')
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
    <!-- text-center, not just start-aligned: the content below (the add-form, the roster
         grid) is independently centered within this wide container via its own mx-auto/
         justify-center, not stretched to fill it -- a start-aligned heading above centered
         content reads as visibly offset from it ("the title is on the right"). Centering the
         heading text keeps it aligned with whatever's centered below, at any content width. -->
    <h1 class="text-center text-lg font-bold text-(--color-text)">تیم</h1>

    <!-- Capped AND centered independently of the page container -- the two short fields
         shouldn't stretch across a laptop, and centering (not just capping) keeps this from
         hugging the RTL start (right) edge with visibly empty space on the other side. -->
    <AppCard class="mx-auto max-w-2xl space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن عضو جدید</h2>
      <AppInput v-model="newWorker.name" placeholder="نام" />
      <AppInput v-model="newWorker.phone" type="tel" inputmode="tel" placeholder="شماره موبایل" class="tnum" />
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <AppButton type="button" variant="primary" block data-testid="submit-add-worker" @click="addWorker">افزودن</AppButton>
    </AppCard>

    <div v-if="loadError" data-testid="load-error" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">تیم بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-load" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <template v-else>
      <div v-if="loading" data-testid="loading-spinner" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>
      <EmptyState v-else-if="workers.length === 0" icon="team" message="هنوز عضوی به تیم اضافه نشده است." />

    <!-- auto-fit + justify-center, not a fixed md:/xl: column count: with a fixed grid, a
         lone (or odd) card at the tail lands in the RTL start (right) column and strands
         empty space beside it -- the exact "not centered" mismatch this was fixed for. This
         still lays out into a multi-column grid once there are enough members to fill a row,
         but centers the actual populated tracks as a group when there aren't.
         max: 1fr, not a fixed px cap -- a fixed max lets each column size independently off
         its own content up to that cap, producing visibly uneven column widths when cards
         differ (the bug BookingsView.vue had); 1fr splits the row's leftover space equally
         across every populated column instead. -->
    <div v-else class="grid items-start justify-center gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      <AppCard v-for="w in workers" :key="w.id" :padded="false" class="space-y-3 p-4">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="break-words text-sm font-bold text-(--color-text)">{{ w.name }}</p>
            <p class="tnum flex items-center gap-1 text-sm text-(--color-text-muted)">
              <AppIcon v-if="w.ratingCount > 0" name="star" :size="14" fill="currentColor" class="text-(--tone-warning-text)" />
              {{ ratingText(w) }}
            </p>
          </div>
          <label class="-mx-1 flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-1 py-2 text-sm text-(--color-text)">
            <input type="checkbox" class="h-4 w-4 accent-(--color-accent)" :checked="w.active" @change="toggleActive(w, $event)" />
            فعال
          </label>
        </div>

        <div v-if="salonServices.length > 0" class="space-y-1">
          <label class="text-sm font-medium text-(--color-text)">خدمات قابل انجام</label>
          <AppMultiSelect
            :model-value="w.serviceIds"
            :options="serviceOptions"
            :disabled="savingServices[w.id]"
            placeholder="همه خدمات (بدون محدودیت)"
            data-testid="worker-services-select"
            @update:model-value="updateWorkerServices(w, $event)"
          />
          <p class="text-xs text-(--color-text-muted)">
            {{ w.serviceIds.length === 0 ? 'این عضو می‌تواند همه خدمات سالن را انجام دهد.' : 'این عضو فقط خدمات انتخاب‌شده را انجام می‌دهد.' }}
          </p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium text-(--color-text)">روزهای مرخصی</label>
          <div class="flex min-w-0 items-center gap-2">
            <div class="min-w-0 flex-1">
              <JalaliDatePicker
                v-model="workerOffDraft[w.id]"
                aria-label="تاریخ مرخصی"
                :data-testid="`worker-off-date-${w.id}`"
              />
            </div>
            <AppButton
              type="button"
              variant="secondary"
              class="shrink-0"
              :data-testid="`add-worker-off-${w.id}`"
              :disabled="!workerOffDraft[w.id] || workerOffSaving[w.id]"
              :loading="workerOffSaving[w.id]"
              @click="addWorkerOffDay(w)"
            >
              <AppIcon name="plus" :size="16" />
            </AppButton>
          </div>
          <ul v-if="workerOffDays(w.id).length > 0" class="space-y-1">
            <li
              v-for="e in workerOffDays(w.id)"
              :key="e.id"
              :data-testid="`worker-off-${e.id}`"
              class="flex items-center justify-between gap-2 rounded-lg bg-(--color-surface) px-3 py-1.5 text-sm text-(--color-text)"
            >
              <span class="tnum">{{ offDayLabel(e) }}</span>
              <button
                type="button"
                aria-label="حذف روز مرخصی"
                :data-testid="`remove-worker-off-${e.id}`"
                class="shrink-0 text-(--color-text-muted) hover:text-(--tone-danger-text)"
                @click="removeWorkerOffDay(e.id)"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </li>
          </ul>
          <p v-else class="text-xs text-(--color-text-muted)">این عضو مرخصی ثبت‌شده‌ای ندارد.</p>
        </div>

        <div>
          <AppButton
            type="button"
            variant="ghost"
            data-testid="toggle-referral-code"
            :aria-expanded="referralRevealed[w.id] ?? false"
            :aria-controls="`referral-panel-${w.id}`"
            @click="toggleReferralCode(w)"
          >
            {{ referralRevealed[w.id] ? 'پنهان کردن کد معرفی' : 'نمایش کد معرفی' }}
          </AppButton>

          <div
            v-if="referralRevealed[w.id]"
            :id="`referral-panel-${w.id}`"
            data-testid="referral-code-panel"
            class="mt-2 flex items-center gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3"
          >
            <p v-if="referralLoading[w.id]" class="text-sm text-(--color-text-muted)">در حال دریافت...</p>
            <p v-else-if="referralError[w.id]" class="text-sm text-(--tone-danger-text)">{{ referralError[w.id] }}</p>
            <template v-else-if="referralCodes[w.id]">
              <!-- A referral code is an unbreakable Latin run; min-w-0 + break-all keeps it
                   inside the panel instead of pushing the copy button out of reach. -->
              <span class="tnum min-w-0 flex-1 break-all text-sm font-bold text-(--color-text)" data-testid="referral-code-value">
                {{ referralCodes[w.id]!.code }}
              </span>
              <AppButton
                type="button"
                variant="secondary"
                class="shrink-0"
                data-testid="copy-referral-code"
                @click="copyReferralCode(referralCodes[w.id]!.code)"
              >
                کپی
              </AppButton>
            </template>
          </div>
        </div>
      </AppCard>
    </div>
    </template>
  </div>
</template>
