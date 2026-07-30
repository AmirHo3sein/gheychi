<!-- apps/provider-panel/src/components/onboarding/SalonInfoStep.vue -->
<script setup lang="ts">
import { computed, useId } from 'vue'
import SalonPinPicker from './SalonPinPicker.vue'
import AppInput from '../ui/AppInput.vue'

const descriptionId = useId()
const genderTargetId = useId()

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

// Client-side mirrors of Create/UpdateSalonDto's @Length bounds (name 2-150, city 2-80,
// address 5-500). Without them a two-letter address passed the parent's "not empty" gate,
// the save button stayed green, and the only feedback was the API's English validator text.
// Shown only once the field has content -- an untouched empty field is the parent's own
// disabled-save/hint concern, not an error to shout about while the form is still blank.
// The upper bounds are enforced by each input's maxlength rather than a message.
const nameError = computed(() =>
  model.value.name.trim() !== '' && model.value.name.trim().length < 2 ? 'نام آرایشگاه باید حداقل ۲ حرف باشد.' : '',
)
const cityError = computed(() =>
  model.value.city.trim() !== '' && model.value.city.trim().length < 2 ? 'نام شهر باید حداقل ۲ حرف باشد.' : '',
)
const addressError = computed(() =>
  model.value.address.trim() !== '' && model.value.address.trim().length < 5 ? 'آدرس باید حداقل ۵ حرف باشد.' : '',
)

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
      :maxlength="150"
      :error="nameError"
    />

    <div>
      <label :for="descriptionId" class="mb-1.5 block text-sm font-semibold text-(--color-text)">توضیحات (اختیاری)</label>
      <textarea
        :id="descriptionId"
        v-model="model.description"
        rows="3"
        placeholder="چند جمله درباره آرایشگاه شما"
        class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
      />
    </div>

    <div>
      <label :for="genderTargetId" class="mb-1.5 block text-sm font-semibold text-(--color-text)">مخاطب آرایشگاه</label>
      <select
        :id="genderTargetId"
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
        :maxlength="80"
        :error="cityError"
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
      :maxlength="500"
      :error="addressError"
    />

    <fieldset class="m-0 min-w-0 border-0 p-0">
      <legend class="mb-1.5 block w-full text-sm font-semibold text-(--color-text)">موقعیت روی نقشه</legend>
      <SalonPinPicker
        :model-value="model.lat !== null && model.lng !== null ? { lat: model.lat, lng: model.lng } : null"
        :center="{ lat: 35.7, lng: 51.4 }"
        @update:model-value="onPin"
      />
    </fieldset>
  </div>
</template>
