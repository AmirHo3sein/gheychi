<!-- apps/provider-panel/src/pages/SalonSettingsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const loaded = ref(false)
const saving = ref(false)

const form = reactive({
  name: '',
  description: '',
  genderTarget: '' as 'women' | 'men' | '',
  address: '',
  city: '',
  capacity: 1,
  lat: null as number | null,
  lng: null as number | null,
})

// Mirrors OnboardingView's isSalonInfoValid -- same fields, same bounds, since this page
// edits an existing salon through the same SalonInfoStep.vue component.
const isFormValid = computed(
  () =>
    form.name.trim().length >= 2 &&
    form.genderTarget !== '' &&
    form.city.trim().length > 0 &&
    form.address.trim().length > 0 &&
    form.capacity >= 1 &&
    form.capacity <= 50 &&
    form.lat !== null &&
    form.lng !== null,
)

async function load() {
  const { data } = await apiFetch<typeof form>('/salons/mine', { silent: true })
  if (data) Object.assign(form, data)
  loaded.value = true
}

async function save() {
  if (!isFormValid.value) return
  saving.value = true
  const { error } = await apiFetch('/salons/mine', {
    method: 'PATCH',
    body: {
      name: form.name,
      description: form.description || undefined,
      genderTarget: form.genderTarget || undefined,
      address: form.address,
      city: form.city,
      capacity: form.capacity,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
    },
  })
  if (!error) pushToast('تغییرات ذخیره شد')
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div v-if="loaded" class="space-y-4 p-4">
    <h1 class="text-lg font-bold">تنظیمات آرایشگاه</h1>
    <SalonInfoStep v-model="form" />
    <button
      data-testid="save-button"
      type="button"
      :disabled="saving || !isFormValid"
      class="w-full rounded-lg bg-(--color-accent) p-3 text-white disabled:opacity-40"
      @click="save"
    >
      ذخیره
    </button>
  </div>
</template>
