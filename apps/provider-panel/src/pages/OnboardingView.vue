<!-- apps/provider-panel/src/pages/OnboardingView.vue -->
<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'

const step = ref(1)

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
})

const isSalonInfoValid = computed(
  () =>
    form.salonInfo.name.trim().length >= 2 &&
    form.salonInfo.genderTarget !== '' &&
    form.salonInfo.city.trim().length > 0 &&
    form.salonInfo.address.trim().length > 0 &&
    form.salonInfo.lat !== null &&
    form.salonInfo.lng !== null,
)

const canGoNext = computed(() => (step.value === 1 ? isSalonInfoValid.value : true))

function next() {
  if (canGoNext.value) step.value++
}
function back() {
  if (step.value > 1) step.value--
}
</script>

<template>
  <div class="mx-auto max-w-md p-6">
    <SalonInfoStep v-if="step === 1" v-model="form.salonInfo" />
    <ScheduleStep v-else-if="step === 2" v-model="form.hours" />

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
    </div>
  </div>
</template>
