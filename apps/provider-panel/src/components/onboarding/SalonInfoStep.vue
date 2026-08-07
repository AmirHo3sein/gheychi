<!-- apps/provider-panel/src/components/onboarding/SalonInfoStep.vue -->
<script setup lang="ts">
import { computed, useId } from 'vue'
import SalonPinPicker from './SalonPinPicker.vue'
import AppInput from '../ui/AppInput.vue'
import AppMultiSelect from '../ui/AppMultiSelect.vue'
import AppSelect from '../ui/AppSelect.vue'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'
import type { SelectOption } from '../ui/AppSelect.vue'

const descriptionId = useId()

// The native <select> this replaced opened with a *disabled* empty <option> -- that was a
// placeholder, not a selectable answer, so it maps to AppSelect's `placeholder` default
// ('انتخاب کنید') rather than to an entry here.
const GENDER_TARGET_OPTIONS: SelectOption[] = [
  { value: 'women', label: 'بانوان' },
  { value: 'men', label: 'آقایان' },
]

const model = defineModel<{
  name: string
  description: string
  genderTarget: 'women' | 'men' | ''
  address: string
  city: string
  capacity: number
  lat: number | null
  lng: number | null
  categoryIds: number[]
}>({ required: true })

// Categories and cities are both fetched by the PARENT (OnboardingView / SalonSettingsView),
// not here -- each parent already owns its own primary-data fetch (POST /salons's
// prerequisites, GET /salons/mine), and having this step fetch independently would race
// that parent's own onMounted call with no defined order.
defineProps<{
  categoryOptions: SelectOption[]
  categoriesLoading: boolean
  categoriesError: boolean
  cityOptions: SelectOption[]
  citiesLoading: boolean
  citiesError: boolean
}>()
const emit = defineEmits<{ retryCategories: []; retryCities: [] }>()

// Client-side mirrors of Create/UpdateSalonDto's @Length bounds (name 2-150, city 2-80,
// address 5-500). Without them a two-letter address passed the parent's "not empty" gate,
// the save button stayed green, and the only feedback was the API's English validator text.
// Shown only once the field has content -- an untouched empty field is the parent's own
// disabled-save/hint concern, not an error to shout about while the form is still blank.
// The upper bounds are enforced by each input's maxlength rather than a message.
const nameError = computed(() =>
  model.value.name.trim() !== '' && model.value.name.trim().length < 2 ? 'نام آرایشگاه باید حداقل ۲ حرف باشد.' : '',
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
      <!-- AppSelect's root is vue-multiselect's combobox <div>, which a native <label for>
           can't target -- so the visible label is a plain <label> (same as the city and
           categories fields below) and the accessible name comes from aria-label. -->
      <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">مخاطب آرایشگاه</label>
      <AppSelect
        :model-value="model.genderTarget || null"
        data-testid="gender-target"
        aria-label="مخاطب آرایشگاه"
        :options="GENDER_TARGET_OPTIONS"
        :searchable="false"
        @update:model-value="model.genderTarget = ($event ?? '') as 'women' | 'men' | ''"
      />
    </div>

    <div>
      <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">دسته‌بندی‌های آرایشگاه</label>
      <p v-if="categoriesError" class="flex items-center gap-2 text-sm text-(--tone-danger-text)">
        <AppIcon name="warning" :size="14" class="shrink-0" />
        دسته‌بندی‌ها بارگذاری نشد.
        <AppButton variant="secondary" data-testid="retry-salon-categories" @click="emit('retryCategories')">تلاش دوباره</AppButton>
      </p>
      <p v-else-if="categoriesLoading" class="flex items-center gap-2 text-sm text-(--color-text-muted)">
        <AppIcon name="spinner" :size="14" class="animate-spin" />
        در حال بارگذاری…
      </p>
      <AppMultiSelect
        v-else
        v-model="model.categoryIds"
        data-testid="salon-categories"
        :options="categoryOptions"
        placeholder="یک یا چند دسته‌بندی انتخاب کنید"
      />
      <p class="mt-1.5 text-xs text-(--color-text-muted)">
        مشتریان بر اساس این دسته‌بندی‌ها آرایشگاه شما را پیدا می‌کنند؛ می‌توانید بیش از یکی انتخاب کنید.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">شهر</label>
        <p v-if="citiesError" class="flex items-center gap-2 text-sm text-(--tone-danger-text)">
          <AppIcon name="warning" :size="14" class="shrink-0" />
          <AppButton variant="secondary" data-testid="retry-cities" @click="emit('retryCities')">تلاش دوباره</AppButton>
        </p>
        <AppSelect
          v-else
          :model-value="model.city || null"
          data-testid="city"
          :options="cityOptions"
          :disabled="citiesLoading"
          :placeholder="citiesLoading ? 'در حال بارگذاری…' : 'شهر را انتخاب کنید'"
          @update:model-value="model.city = String($event ?? '')"
        />
      </div>
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
