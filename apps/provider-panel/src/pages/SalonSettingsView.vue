<!-- apps/provider-panel/src/pages/SalonSettingsView.vue -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

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
  const { data } = await apiFetch<SalonResponse>('/salons/mine', { silent: true })
  if (data) {
    const { location, tagline, about, instagramHandle, ...rest } = data
    Object.assign(form, rest)
    form.lng = location.coordinates[0]
    form.lat = location.coordinates[1]
    form.tagline = tagline ?? ''
    form.about = about ?? ''
    form.instagramHandle = instagramHandle ?? ''
  }
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
  <div v-if="loaded" class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">تنظیمات آرایشگاه</h1>
    <div class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-panel)">
      <SalonInfoStep v-model="form" />
    </div>

    <div class="space-y-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-panel)">
      <h2 class="font-bold text-(--color-text)">پروفایل عمومی</h2>

      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label class="block text-sm font-semibold text-(--color-text)">شعار سالن</label>
          <span class="tnum text-xs text-(--color-muted)">{{ form.tagline.length.toLocaleString('fa-IR') }}/۱۲۰</span>
        </div>
        <input
          v-model="form.tagline"
          data-testid="tagline"
          maxlength="120"
          placeholder="مثلاً زیبایی شما، تخصص ما"
          class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
        />
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between">
          <label class="block text-sm font-semibold text-(--color-text)">درباره سالن</label>
          <span class="tnum text-xs text-(--color-muted)">{{ form.about.length.toLocaleString('fa-IR') }}/۲۰۰۰</span>
        </div>
        <textarea
          v-model="form.about"
          data-testid="about"
          rows="5"
          maxlength="2000"
          placeholder="داستان سالن، تخصص‌ها و هر چیزی که مشتری باید بداند"
          class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm"
        />
        <p class="mt-1 text-xs text-(--color-muted)">شکست خط‌ها همان‌طور که می‌نویسید در صفحه عمومی نمایش داده می‌شوند.</p>
      </div>

      <div>
        <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">آیدی اینستاگرام</label>
        <div dir="ltr" class="flex items-center overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card)">
          <span class="select-none border-e border-(--color-border) bg-(--color-border-soft) p-3 text-sm text-(--color-muted)">instagram.com/</span>
          <input
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
          class="mt-1.5 flex items-center gap-1.5 text-xs text-(--tone-danger-text)"
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
        <p class="mb-2 text-xs font-semibold text-(--color-muted)">پیش‌نمایش صفحه عمومی</p>
        <p v-if="form.tagline.trim()" class="text-sm text-(--color-muted)">{{ form.tagline.trim() }}</p>
        <p v-if="form.about.trim()" class="mt-1 whitespace-pre-line text-sm text-(--color-text)">{{ aboutExcerpt }}</p>
      </div>
    </div>

    <button
      data-testid="save-button"
      type="button"
      :disabled="saving || !isFormValid"
      class="flex w-full items-center justify-center gap-2 rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      @click="save"
    >
      <AppIcon name="check" :size="16" />
      {{ saving ? 'در حال ذخیره…' : 'ذخیره' }}
    </button>
  </div>
</template>
