<!-- apps/provider-panel/src/pages/TeamView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
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

function ratingLabel(w: Worker): string {
  if (w.ratingCount === 0) return 'بدون امتیاز'
  return `⭐ ${Number(w.ratingAvg).toFixed(1)} (${w.ratingCount.toLocaleString('fa-IR')} نظر)`
}

async function addWorker() {
  createError.value = ''
  if (!newWorker.name.trim() || !newWorker.phone.trim()) return

  // Not silent: a 409 (duplicate worker) or 400 (self-hire) both need to surface inline,
  // not just via the generic toast -- the toast still fires too (useApi's default non-silent behavior).
  const { data, error } = await apiFetch<Worker>('/salons/mine/workers', {
    method: 'POST',
    body: { name: newWorker.name.trim(), phone: newWorker.phone.trim() },
  })
  if (error) {
    createError.value = error.status === 409 ? 'این کاربر از قبل عضو تیم است.' : error.message
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
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">تیم</h1>

    <AppCard class="space-y-3">
      <h2 class="font-bold text-(--color-text)">افزودن عضو جدید</h2>
      <input
        v-model="newWorker.name"
        placeholder="نام"
        class="w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
      />
      <input
        v-model="newWorker.phone"
        placeholder="شماره موبایل"
        class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-3 text-sm"
      />
      <p v-if="createError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
        {{ createError }}
      </p>
      <button
        type="button"
        class="w-full rounded-xl bg-(--color-accent) p-3 text-sm font-bold text-white transition-opacity hover:opacity-90"
        @click="addWorker"
      >
        افزودن
      </button>
    </AppCard>

    <EmptyState v-if="!loading && workers.length === 0" icon="team" message="هنوز عضوی به تیم اضافه نشده است." />

    <AppCard v-for="w in workers" :key="w.id" :padded="false" class="space-y-3 p-4">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-bold text-(--color-text)">{{ w.name }}</p>
          <p class="tnum text-sm text-(--color-muted)">{{ ratingLabel(w) }}</p>
        </div>
        <label class="flex items-center gap-2 text-sm text-(--color-text)">
          <input type="checkbox" class="h-4 w-4 accent-(--color-accent)" :checked="w.active" @change="toggleActive(w, $event)" />
          فعال
        </label>
      </div>

      <div>
        <button
          type="button"
          data-testid="toggle-referral-code"
          class="text-sm font-bold text-(--color-accent) hover:opacity-90"
          @click="toggleReferralCode(w)"
        >
          {{ referralRevealed[w.id] ? 'پنهان کردن کد معرفی' : 'نمایش کد معرفی' }}
        </button>

        <div
          v-if="referralRevealed[w.id]"
          data-testid="referral-code-panel"
          class="mt-2 flex items-center gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) p-3"
        >
          <p v-if="referralLoading[w.id]" class="text-sm text-(--color-muted)">در حال دریافت...</p>
          <p v-else-if="referralError[w.id]" class="text-sm text-(--tone-danger-text)">{{ referralError[w.id] }}</p>
          <template v-else-if="referralCodes[w.id]">
            <span class="tnum flex-1 text-sm font-bold text-(--color-text)" data-testid="referral-code-value">
              {{ referralCodes[w.id]!.code }}
            </span>
            <button
              type="button"
              data-testid="copy-referral-code"
              class="rounded-lg bg-(--color-accent) px-3 py-1 text-xs font-bold text-white transition-opacity hover:opacity-90"
              @click="copyReferralCode(referralCodes[w.id]!.code)"
            >
              کپی
            </button>
          </template>
        </div>
      </div>
    </AppCard>
  </div>
</template>
