<!-- apps/provider-panel/src/components/onboarding/SalonInfoStep.vue -->
<script setup lang="ts">
import SalonPinPicker from './SalonPinPicker.vue'

const model = defineModel<{
  name: string
  description: string
  genderTarget: 'women' | 'men' | ''
  address: string
  city: string
  capacity: number
  lat: number | null
  lng: number | null
}>({ required: true })

function onPin(pos: { lat: number; lng: number }) {
  model.value.lat = pos.lat
  model.value.lng = pos.lng
}
</script>

<template>
  <div class="space-y-3">
    <input v-model="model.name" data-testid="salon-name" placeholder="نام آرایشگاه" class="w-full rounded-lg border p-3" />
    <textarea v-model="model.description" placeholder="توضیحات (اختیاری)" class="w-full rounded-lg border p-3" />
    <select v-model="model.genderTarget" data-testid="gender-target" class="w-full rounded-lg border p-3">
      <option value="" disabled>مخاطب آرایشگاه</option>
      <option value="women">بانوان</option>
      <option value="men">آقایان</option>
    </select>
    <input v-model="model.city" data-testid="city" placeholder="شهر" class="w-full rounded-lg border p-3" />
    <input v-model="model.address" data-testid="address" placeholder="آدرس" class="w-full rounded-lg border p-3" />
    <input
      v-model.number="model.capacity"
      data-testid="capacity"
      type="number"
      min="1"
      max="50"
      placeholder="ظرفیت همزمان"
      class="w-full rounded-lg border p-3"
    />
    <SalonPinPicker
      :model-value="model.lat !== null && model.lng !== null ? { lat: model.lat, lng: model.lng } : null"
      :center="{ lat: 35.7, lng: 51.4 }"
      @update:model-value="onPin"
    />
  </div>
</template>
