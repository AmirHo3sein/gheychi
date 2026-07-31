<!-- apps/provider-panel/src/pages/TeamView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

interface Worker {
  id: string
  name: string
  active: boolean
  // numeric(3,2) column -- comes back as a string, same as salon.ratingAvg elsewhere.
  ratingAvg: string
  ratingCount: number
  createdAt: string
}

interface ReferralCode {
  code: string
  isActive: boolean
  shareUrl: string
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const workers = ref<Worker[]>([])
const loading = ref(true)
const createError = ref('')
const newWorker = reactive({ name: '', phone: '' })

// Per-worker referral-code reveal state, keyed by worker id. Kept separate from the
// Worker list itself (rather than a field on Worker) since the code is fetched lazily,
// one owner-relay lookup at a time, not as part of the initial list load.
const referralRevealed = reactive<Record<string, boolean>>({})
const referralLoading = reactive<Record<string, boolean>>({})
const referralError = reactive<Record<string, string>>({})
const referralCodes = reactive<Record<string, ReferralCode>>({})

async function load() {
  const { data } = await apiFetch<Worker[]>('/salons/mine/workers', { silent: true })
  workers.value = data ?? []
  loading.value = false
}

onMounted(load)

function ratingText(w: Worker): string {
  if (w.ratingCount === 0) return 'بدون امتیاز'
  return `${Number(w.ratingAvg).toFixed(1)} (${w.ratingCount.toLocaleString('fa-IR')} نظر)`
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
    body: { name: newWorker.name.trim(), phone: newWorker.phone.trim() },
  })
  if (error) {
    createError.value = error.status === 409
      ? 'این کاربر از قبل عضو تیم است.'
      : 'اطلاعات وارد شده نامعتبر است. لطفاً نام و شماره موبایل را بررسی کنید.'
    return
  }
  if (data) workers.value.unshift(data)

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
    <h1 class="text-lg font-bold text-(--color-text)">تیم</h1>

    <!-- Capped independently of the page container so the two short fields don't stretch
         across a laptop while the roster below still uses the full width. -->
    <AppCard class="max-w-2xl space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن عضو جدید</h2>
      <AppInput v-model="newWorker.name" placeholder="نام" />
      <AppInput v-model="newWorker.phone" type="tel" inputmode="tel" placeholder="شماره موبایل" class="tnum" />
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <AppButton type="button" variant="primary" block data-testid="submit-add-worker" @click="addWorker">افزودن</AppButton>
    </AppCard>

    <div v-if="loading" data-testid="loading-spinner" class="flex items-center justify-center py-8 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>
    <EmptyState v-else-if="workers.length === 0" icon="team" message="هنوز عضوی به تیم اضافه نشده است." />

    <!-- Roster in columns from md: more of the team visible per screen rather than one very
         wide row per member. -->
    <div v-else class="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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
  </div>
</template>
