<!-- apps/provider-panel/src/components/onboarding/SalonInfoStep.vue -->
<script setup lang="ts">
import SalonPinPicker from './SalonPinPicker.vue'
import AppInput from '../ui/AppInput.vue'

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
  <div class="space-y-4">
    <AppInput
      v-model="model.name"
      label="نام آرایشگاه"
      data-testid="salon-name"
      placeholder="مثلاً سالن زیبایی ستاره"
    />

    <div>
      <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">توضیحات (اختیاری)</label>
      <textarea
        v-model="model.description"
        rows="3"
        placeholder="چند جمله درباره آرایشگاه شما"
        class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
      />
    </div>

    <div>
      <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">مخاطب آرایشگاه</label>
      <select
        v-model="model.genderTarget"
        data-testid="gender-target"
        class="native-select w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
      >
        <option value="" disabled>انتخاب کنید</option>
        <option value="women">بانوان</option>
        <option value="men">آقایان</option>
      </select>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <AppInput
        v-model="model.city"
        label="شهر"
        data-testid="city"
        placeholder="شهر"
      />
      <AppInput
        :model-value="String(model.capacity)"
        label="ظرفیت همزمان"
        data-testid="capacity"
        type="number"
        min="1"
        max="50"
        class="tnum"
        @update:model-value="model.capacity = Number($event)"
      />
    </div>

    <AppInput
      v-model="model.address"
      label="آدرس"
      data-testid="address"
      placeholder="آدرس کامل"
    />

    <div>
      <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">موقعیت روی نقشه</label>
      <SalonPinPicker
        :model-value="model.lat !== null && model.lng !== null ? { lat: model.lat, lng: model.lng } : null"
        :center="{ lat: 35.7, lng: 51.4 }"
        @update:model-value="onPin"
      />
    </div>
  </div>
</template>
