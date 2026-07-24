<!-- apps/provider-panel/src/pages/OnboardingView.vue -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import FirstServiceStep from '@/components/onboarding/FirstServiceStep.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'

const STEP_LABELS = ['اطلاعات آرایشگاه', 'ساعات کاری', 'اولین خدمت']

const router = useRouter()
const { apiFetch } = useApi()
const { refetch } = useSalon()

const step = ref(1)
const submitting = ref(false)
const submitError = ref('')
// Tracks whether POST /salons already succeeded in a prior submit() attempt so a retry
// (after the hours/services calls below failed) doesn't re-POST and hit a 409 "you
// already have a salon" error.
const salonCreated = ref(false)

const form = reactive({
  salonInfo: {
    name: '',
    description: '',
    genderTarget: '' as 'women' | 'men' | '',
    address: '',
    city: '',
    capacity: 1,
    lat: null as number | null,
    lng: null as number | null,
  },
  hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openTime: '09:00',
    closeTime: '20:00',
    enabled: false,
  })),
  service: {
    categoryId: null as number | null,
    name: '',
    price: 0,
    durationMin: 30,
  },
})

const isSalonInfoValid = computed(
  () =>
    form.salonInfo.name.trim().length >= 2 &&
    form.salonInfo.genderTarget !== '' &&
    form.salonInfo.city.trim().length > 0 &&
    form.salonInfo.address.trim().length > 0 &&
    form.salonInfo.capacity >= 1 &&
    form.salonInfo.capacity <= 50 &&
    form.salonInfo.lat !== null &&
    form.salonInfo.lng !== null,
)

const isServiceValid = computed(
  () =>
    form.service.categoryId !== null &&
    form.service.name.trim().length >= 2 &&
    form.service.price >= 0 &&
    form.service.durationMin >= 5 &&
    form.service.durationMin <= 600,
)

const canGoNext = computed(() => (step.value === 1 ? isSalonInfoValid.value : true))

function next() {
  if (canGoNext.value) step.value++
}
function back() {
  if (step.value > 1) step.value--
}

async function submit() {
  if (!isServiceValid.value) return
  submitting.value = true
  submitError.value = ''

  if (!salonCreated.value) {
    const { data: salon, error: salonError } = await apiFetch<{ id: string }>('/salons', {
      method: 'POST',
      body: {
        name: form.salonInfo.name,
        description: form.salonInfo.description || undefined,
        genderTarget: form.salonInfo.genderTarget,
        address: form.salonInfo.address,
        city: form.salonInfo.city,
        capacity: form.salonInfo.capacity,
        lat: form.salonInfo.lat,
        lng: form.salonInfo.lng,
      },
      silent: true,
    })
    if (salonError || !salon) {
      submitError.value = 'ثبت اطلاعات آرایشگاه ناموفق بود. دوباره تلاش کنید.'
      submitting.value = false
      return
    }
    salonCreated.value = true
  }

  const enabledHours = form.hours
    .filter((h) => h.enabled)
    .map(({ weekday, openTime, closeTime }) => ({ weekday, openTime, closeTime }))
  if (enabledHours.length) {
    const { error: hoursError } = await apiFetch('/salons/mine/hours', {
      method: 'PUT',
      body: { hours: enabledHours },
    })
    if (hoursError) {
      submitError.value = 'ثبت ساعات کاری ناموفق بود. دوباره تلاش کنید.'
      submitting.value = false
      return
    }
  }

  const { error: serviceError } = await apiFetch('/salons/mine/services', { method: 'POST', body: form.service })
  if (serviceError) {
    submitError.value = 'ثبت خدمت ناموفق بود. دوباره تلاش کنید.'
    submitting.value = false
    return
  }

  await refetch()
  await router.push('/pending-approval')
}
</script>

<template>
  <div class="mx-auto max-w-md p-6">
    <div class="mb-6 flex flex-col items-center text-center">
      <div class="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-(--color-accent) text-lg font-black text-white shadow-(--shadow-sm)">
        آ
      </div>
      <h1 class="text-lg font-bold text-(--color-text)">ثبت‌نام آرایشگاه</h1>
    </div>

    <div class="mb-6 flex items-center gap-2">
      <template v-for="(label, i) in STEP_LABELS" :key="label">
        <div class="flex flex-1 flex-col items-center gap-1.5">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors"
            :class="
              i + 1 < step
                ? 'bg-(--color-accent) text-white'
                : i + 1 === step
                  ? 'border-2 border-(--color-accent) text-(--color-accent)'
                  : 'border border-(--color-border) text-(--color-text-muted)'
            "
          >
            <AppIcon v-if="i + 1 < step" name="check" :size="14" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span class="text-[11px] text-(--color-text-muted)">{{ label }}</span>
        </div>
        <div v-if="i < STEP_LABELS.length - 1" class="mb-4 h-px flex-1 bg-(--color-border)" />
      </template>
    </div>

    <div class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-sm)">
      <SalonInfoStep v-if="step === 1" v-model="form.salonInfo" />
      <ScheduleStep v-else-if="step === 2" v-model="form.hours" />
      <FirstServiceStep v-else v-model="form.service" />
    </div>

    <p v-if="submitError" class="mt-3 flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
      <AppIcon name="warning" :size="16" class="shrink-0" />
      {{ submitError }}
    </p>

    <div class="mt-4 flex justify-between gap-3">
      <AppButton v-if="step > 1" type="button" variant="secondary" @click="back">
        قبلی
      </AppButton>
      <AppButton v-if="step < 3" data-testid="wizard-next" type="button" class="mr-auto" :disabled="!canGoNext" @click="next">
        بعدی
      </AppButton>
      <AppButton
        v-else
        data-testid="wizard-submit"
        type="button"
        class="mr-auto"
        :disabled="!isServiceValid || submitting"
        :loading="submitting"
        @click="submit"
      >
        {{ submitting ? 'در حال ثبت…' : 'ثبت و ارسال برای بررسی' }}
      </AppButton>
    </div>
  </div>
</template>
