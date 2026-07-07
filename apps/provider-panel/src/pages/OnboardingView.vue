<!-- apps/provider-panel/src/pages/OnboardingView.vue -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import FirstServiceStep from '@/components/onboarding/FirstServiceStep.vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'

const router = useRouter()
const { apiFetch } = useApi()
const { refetch } = useSalon()

const step = ref(1)
const submitting = ref(false)
const submitError = ref('')

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

  const enabledHours = form.hours
    .filter((h) => h.enabled)
    .map(({ weekday, openTime, closeTime }) => ({ weekday, openTime, closeTime }))
  if (enabledHours.length) {
    await apiFetch('/salons/mine/hours', { method: 'PUT', body: { hours: enabledHours } })
  }

  await apiFetch('/salons/mine/services', { method: 'POST', body: form.service })

  await refetch()
  await router.push('/pending-approval')
}
</script>

<template>
  <div class="mx-auto max-w-md p-6">
    <SalonInfoStep v-if="step === 1" v-model="form.salonInfo" />
    <ScheduleStep v-else-if="step === 2" v-model="form.hours" />
    <FirstServiceStep v-else v-model="form.service" />

    <p v-if="submitError" class="mt-2 text-sm text-red-600">{{ submitError }}</p>

    <div class="mt-4 flex justify-between">
      <button v-if="step > 1" type="button" class="rounded-lg border px-4 py-2" @click="back">قبلی</button>
      <button
        v-if="step < 3"
        data-testid="wizard-next"
        type="button"
        :disabled="!canGoNext"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-white disabled:opacity-40"
        @click="next"
      >
        بعدی
      </button>
      <button
        v-else
        data-testid="wizard-submit"
        type="button"
        :disabled="!isServiceValid || submitting"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-white disabled:opacity-40"
        @click="submit"
      >
        ثبت و ارسال برای بررسی
      </button>
    </div>
  </div>
</template>
