<!-- apps/provider-panel/src/pages/SalonSettingsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref, useId } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
const aboutId = useId()
const instagramId = useId()

const form = reactive({
  name: '',
  description: '',
  genderTarget: '' as 'women' | 'men' | '',
  address: '',
  city: '',
  capacity: 1,
  lat: null as number | null,
  lng: null as number | null,
  tagline: '',
  about: '',
  instagramHandle: '',
})

// Client-side mirror of UpdateSalonDto's instagramHandle @Matches regex -- the charset
// guarantee that makes instagram.com/<handle> links injection-free on the public page.
const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/
const instagramHandleValid = computed(() => form.instagramHandle === '' || INSTAGRAM_HANDLE_RE.test(form.instagramHandle))

// Mirrors OnboardingView's isSalonInfoValid -- same fields, same bounds, since this page
// edits an existing salon through the same SalonInfoStep.vue component. The showcase
// profile fields are optional, so only their format/length constraints gate the save.
const isFormValid = computed(
  () =>
    form.name.trim().length >= 2 &&
    form.genderTarget !== '' &&
    form.city.trim().length > 0 &&
    form.address.trim().length > 0 &&
    form.capacity >= 1 &&
    form.capacity <= 50 &&
    form.lat !== null &&
    form.lng !== null &&
    form.tagline.length <= 120 &&
    form.about.length <= 2000 &&
    instagramHandleValid.value,
)

// The public salon page renders `about` in full (only its SEO meta description is
// excerpted, in the user-app's salon-seo.ts); this preview truncates purely to keep
// the card compact. Sliced by code points (Array.from -- the user-app excerpt
// convention), not UTF-16 units, so the cut never splits a surrogate pair (e.g. an
// emoji at the boundary) into a broken replacement character.
const aboutExcerpt = computed(() => {
  const about = form.about.trim()
  const points = Array.from(about)
  return points.length > 200 ? `${points.slice(0, 200).join('')}…` : about
})

// GET /salons/mine returns the raw Salon entity: geo data comes back as a PostGIS
// geography column, `location: { type: 'Point', coordinates: [lng, lat] }` -- there is
// no top-level lat/lng field. Note the coordinate order (lng first), matching
// apps/user-app's geoJsonToLatLng (app/utils/geo.ts).
interface SalonResponse extends Omit<typeof form, 'lat' | 'lng' | 'tagline' | 'about' | 'instagramHandle'> {
  location: { type: 'Point'; coordinates: [number, number] }
  tagline: string | null
  about: string | null
  instagramHandle: string | null
}

async function load() {
  loading.value = true
  loadError.value = false
  const { data, error } = await apiFetch<SalonResponse>('/salons/mine', { silent: true })
  if (error || !data) {
    loadError.value = true
    loading.value = false
    return
  }
  const { location, tagline, about, instagramHandle, ...rest } = data
  Object.assign(form, rest)
  form.lng = location.coordinates[0]
  form.lat = location.coordinates[1]
  form.tagline = tagline ?? ''
  form.about = about ?? ''
  form.instagramHandle = instagramHandle ?? ''
  loading.value = false
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
      // Empty strings deliberately go through as-is: the API @Transforms '' -> null so a
      // previously-set showcase field can be cleared (`|| undefined` would make clearing
      // impossible by omitting the key).
      tagline: form.tagline.trim(),
      about: form.about.trim(),
      instagramHandle: form.instagramHandle.trim(),
    },
  })
  if (!error) pushToast('تغییرات ذخیره شد')
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">تنظیمات آرایشگاه</h1>

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">اطلاعات آرایشگاه بارگذاری نشد.</p>
      <AppButton variant="secondary" data-testid="retry-settings" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <div v-else-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
      <AppIcon name="spinner" :size="20" class="animate-spin" />
    </div>

    <template v-else>
      <div class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-sm)">
        <SalonInfoStep v-model="form" />
      </div>

      <div class="space-y-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-sm)">
        <h2 class="font-bold text-(--color-text)">پروفایل عمومی</h2>

        <div>
          <AppInput
            v-model="form.tagline"
            label="شعار سالن"
            data-testid="tagline"
            :maxlength="120"
            placeholder="مثلاً زیبایی شما، تخصص ما"
          />
          <p class="tnum mt-1 text-end text-xs text-(--color-text-muted)">{{ form.tagline.length.toLocaleString('fa-IR') }}/۱۲۰</p>
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <label :for="aboutId" class="block text-sm font-semibold text-(--color-text)">درباره سالن</label>
            <span class="tnum text-xs text-(--color-text-muted)">{{ form.about.length.toLocaleString('fa-IR') }}/۲۰۰۰</span>
          </div>
          <textarea
            :id="aboutId"
            v-model="form.about"
            data-testid="about"
            rows="5"
            maxlength="2000"
            placeholder="داستان سالن، تخصص‌ها و هر چیزی که مشتری باید بداند"
            class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
          />
          <p class="mt-1 text-xs text-(--color-text-muted)">شکست خط‌ها همان‌طور که می‌نویسید در صفحه عمومی نمایش داده می‌شوند.</p>
        </div>

        <div>
          <label :for="instagramId" class="mb-1.5 block text-sm font-semibold text-(--color-text)">آیدی اینستاگرام</label>
          <div dir="ltr" class="flex items-center overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card)">
            <span class="select-none border-e border-(--color-border) bg-(--color-border-soft) p-3 text-sm text-(--color-text-muted)">instagram.com/</span>
            <input
              :id="instagramId"
              v-model="form.instagramHandle"
              data-testid="instagram-handle"
              dir="ltr"
              maxlength="30"
              placeholder="my.salon"
              class="w-full bg-transparent p-3 text-sm outline-none"
            />
          </div>
          <p
            v-if="!instagramHandleValid"
            data-testid="instagram-error"
            class="mt-1.5 flex items-center gap-1.5 text-xs text-(--color-danger)"
          >
            <AppIcon name="warning" :size="13" class="shrink-0" />
            آیدی اینستاگرام فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه و زیرخط باشد.
          </p>
        </div>

        <div
          v-if="form.tagline.trim() || form.about.trim()"
          data-testid="profile-preview"
          class="rounded-xl border border-dashed border-(--color-border) bg-(--color-surface) p-3"
        >
          <p class="mb-2 text-xs font-semibold text-(--color-text-muted)">پیش‌نمایش صفحه عمومی</p>
          <p v-if="form.tagline.trim()" class="text-sm text-(--color-text-muted)">{{ form.tagline.trim() }}</p>
          <p v-if="form.about.trim()" class="mt-1 whitespace-pre-line text-sm text-(--color-text)">{{ aboutExcerpt }}</p>
        </div>
      </div>

      <AppButton
        data-testid="save-button"
        type="button"
        variant="primary"
        block
        :loading="saving"
        :disabled="!isFormValid"
        @click="save"
      >
        <template #icon><AppIcon name="check" :size="16" /></template>
        {{ saving ? 'در حال ذخیره…' : 'ذخیره' }}
      </AppButton>
    </template>
  </div>
</template>
