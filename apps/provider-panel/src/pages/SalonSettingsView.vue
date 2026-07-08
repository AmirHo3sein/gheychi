<!-- apps/provider-panel/src/pages/SalonSettingsView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'

const { apiFetch } = useApi()
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

async function load() {
  const { data } = await apiFetch<typeof form>('/salons/mine', { silent: true })
  if (data) Object.assign(form, data)
  loaded.value = true
}

async function save() {
  saving.value = true
  await apiFetch('/salons/mine', {
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
      :disabled="saving"
      class="w-full rounded-lg bg-(--color-accent) p-3 text-white"
      @click="save"
    >
      ذخیره
    </button>
  </div>
</template>
