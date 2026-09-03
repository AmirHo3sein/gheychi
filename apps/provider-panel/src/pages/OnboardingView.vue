<!-- apps/provider-panel/src/pages/OnboardingView.vue -->
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'
import ScheduleStep from '@/components/onboarding/ScheduleStep.vue'
import FirstServiceStep from '@/components/onboarding/FirstServiceStep.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useCities } from '@/composables/useCities'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { useServiceCategories } from '@/composables/useServiceCategories'
import { useSessionStore } from '@/stores/session'
import { validateWorkingHours } from '@/utils/working-hours'

const STEP_LABELS = ['اطلاعات آرایشگاه', 'ساعات کاری', 'اولین خدمت']

const router = useRouter()
const { apiFetch } = useApi()
const { refetch } = useSalon()
const session = useSessionStore()
const { categoryOptions, loading: categoriesLoading, error: categoriesError, load: loadCategories } = useServiceCategories()
const { cityOptions, loading: citiesLoading, error: citiesError, load: loadCities } = useCities()
onMounted(loadCategories)
onMounted(loadCities)

const step = ref(1)
const submitting = ref(false)
const submitError = ref('')
const stepCard = useTemplateRef<HTMLDivElement>('stepCard')

// This route sits outside AppLayout (see router/index.ts), so its own header is the
// only chrome the wizard has -- without this, a user stuck on /onboarding under the
// wrong account (the nav guard forces every route back here while salon is null) has no
// way out short of manually clearing cookies. Mirrors AppLayout.vue's logout().
async function logout() {
  await apiFetch('/auth/logout', { method: 'POST', silent: true })
  session.setUser(null)
  // Same reason as AppLayout's: `checked` is true here (the guard already probed and
  // found no salon), so without a reset the next account to log in would be sent
  // straight back to onboarding without ever being probed.
  resetSalon()
  await router.push('/login')
}
// Tracks whether POST /salons already succeeded in a prior submit() attempt so a retry
// (after the hours/services calls below failed) doesn't re-POST and hit a 409 "you
// already have a salon" error.
const salonCreated = ref(false)

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
    categoryIds: [] as number[],
  },
  hours: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    enabled: false,
    ranges: [{ openTime: '09:00', closeTime: '20:00' }],
  })),
  service: {
    categoryId: null as number | null,
    name: '',
    // Starts empty, not 0 -- see FirstServiceStep.vue's model comment.
    price: null as number | null,
    durationMin: 30,
  },
})

// City/address minimums match CreateSalonDto's @Length(2, 80)/@Length(5, 500) -- a merely
// non-empty check let a short value through to a POST that could only fail server-side,
// with an English validator message as the sole feedback.
const isSalonInfoValid = computed(
  () =>
    form.salonInfo.name.trim().length >= 2 &&
    form.salonInfo.genderTarget !== '' &&
    form.salonInfo.city.trim().length >= 2 &&
    form.salonInfo.address.trim().length >= 5 &&
    form.salonInfo.capacity >= 1 &&
    form.salonInfo.capacity <= 50 &&
    form.salonInfo.lat !== null &&
    form.salonInfo.lng !== null &&
    form.salonInfo.categoryIds.length >= 1,
)

// Same rule HoursView.vue saves against (utils/working-hours.ts). Step 2 has to enforce it
// too: submit() POSTs /salons before it PUTs the hours, so an openTime >= closeTime the
// API rejects would leave the owner with an already-created salon and no hours -- and
// retrying the same invalid range can never succeed.
const hoursValidation = computed(() => validateWorkingHours(form.hours))

// An owner who submits with zero enabled days would go live completely unbookable
// with no warning -- require at least one before step 2 can advance.
const isHoursValid = computed(() => form.hours.some((h) => h.enabled) && hoursValidation.value.message === '')

// Same rule (and copy) as ServicesView.vue's addService(): the API's @Min(0) would accept
// a 0 and publish a free, bookable first service with a 0 deposit -- a genuinely free
// service isn't something this wizard offers, and 0 is exactly what an untouched field
// used to submit.
const SERVICE_PRICE_ERROR = 'قیمت خدمت باید یک عدد صحیح بزرگ‌تر از صفر باشد.'
const isServicePriceValid = computed(
  () => form.service.price !== null && Number.isInteger(form.service.price) && form.service.price > 0,
)

const isServiceOtherFieldsValid = computed(
  () =>
    form.service.categoryId !== null &&
    form.service.name.trim().length >= 2 &&
    form.service.durationMin >= 5 &&
    form.service.durationMin <= 600,
)

const isServiceValid = computed(() => isServiceOtherFieldsValid.value && isServicePriceValid.value)

const canGoNext = computed(() => {
  if (step.value === 1) return isSalonInfoValid.value
  if (step.value === 2) return isHoursValid.value
  return true
})

// Which of the several gating conditions on the current step is unmet, shown as a brief
// inline hint next to the disabled next/submit button rather than leaving it a silent
// dead end.
const disabledHint = computed(() => {
  if (step.value === 1 && !isSalonInfoValid.value) {
    return 'برای ادامه، نام (حداقل ۲ حرف)، مخاطب، شهر (حداقل ۲ حرف)، آدرس (حداقل ۵ حرف)، ظرفیت (۱ تا ۵۰)، حداقل یک دسته‌بندی و موقعیت روی نقشه را کامل کنید.'
  }
  if (step.value === 2 && !isHoursValid.value) {
    return hoursValidation.value.message || 'حداقل یک روز کاری را فعال کنید تا آرایشگاه قابل رزرو باشد.'
  }
  if (step.value === 3 && !isServiceValid.value) {
    // When the price is the only thing left, say exactly what's wrong with it rather than
    // re-listing every field -- an owner who typed 0 needs to hear "greater than zero".
    if (isServiceOtherFieldsValid.value) return SERVICE_PRICE_ERROR
    return 'برای ثبت، دسته‌بندی، نام خدمت (حداقل ۲ حرف)، قیمت (بزرگ‌تر از صفر) و مدت زمان معتبر (۵ تا ۶۰۰ دقیقه) وارد کنید.'
  }
  return ''
})

function next() {
  if (canGoNext.value) step.value++
}
function back() {
  if (step.value > 1) step.value--
}

// Move focus/scroll to the new step's card so a step change is legible instead of
// leaving the viewport wherever it was on a long page.
watch(step, () => {
  nextTick(() => {
    stepCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    stepCard.value?.focus()
  })
})

async function submit() {
  if (!isServiceValid.value) return
  submitting.value = true
  submitError.value = ''

  if (!salonCreated.value) {
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
        categoryIds: form.salonInfo.categoryIds,
      },
      silent: true,
    })
    if (salonError || !salon) {
      submitError.value = 'ثبت اطلاعات آرایشگاه ناموفق بود. دوباره تلاش کنید.'
      submitting.value = false
      return
    }
    salonCreated.value = true
  }

  const enabledHours = form.hours
    .filter((h) => h.enabled)
    .flatMap((h) => h.ranges.map((r) => ({ weekday: h.weekday, openTime: r.openTime, closeTime: r.closeTime })))
  if (enabledHours.length) {
    const { error: hoursError } = await apiFetch('/salons/mine/hours', {
      method: 'PUT',
      body: { hours: enabledHours },
    })
    if (hoursError) {
      // The salon row already exists at this point, so point at the step that can actually
      // fix this instead of inviting a retry of the exact same rejected payload.
      submitError.value = 'ثبت ساعات کاری ناموفق بود. با دکمه «قبلی» ساعات کاری را بررسی و دوباره تلاش کنید.'
      submitting.value = false
      return
    }
  }

  const { error: serviceError } = await apiFetch('/salons/mine/services', { method: 'POST', body: form.service })
  if (serviceError) {
    submitError.value = 'ثبت خدمت ناموفق بود. دوباره تلاش کنید.'
    submitting.value = false
    return
  }

  await refetch()
  await router.push('/pending-approval')
}
</script>

<template>
  <!-- p-4 at 320px: 48px of page padding on a 320px screen is a sixth of the viewport.
       max-w-xl from sm gives the step-1 map picker and its coordinate fields room to be
       usable in the desktop setup session PRODUCT.md calls out. -->
  <div class="mx-auto w-full max-w-md p-4 sm:max-w-xl sm:p-6">
    <div class="mb-6 flex items-center justify-between gap-2">
      <!-- Mirrors the logout button's footprint so the title stays optically centred. -->
      <div class="w-11 shrink-0" />
      <div class="flex min-w-0 flex-col items-center text-center">
        <img src="/brand-icon.png" alt="" class="mb-2 h-11 w-11 shrink-0 rounded-2xl shadow-(--shadow-sm)" />
        <h1 class="text-lg font-bold text-(--color-text)">ثبت‌نام آرایشگاه</h1>
      </div>
      <button
        type="button"
        title="خروج"
        data-testid="onboarding-logout"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text)"
        @click="logout"
      >
        <AppIcon name="logout" :size="18" />
      </button>
    </div>

    <!-- gap-1 at 320px: with three labelled steps and two connectors, gap-2 spent 16px of a
         272px row on whitespace. -->
    <div class="mb-6 flex items-center gap-1 sm:gap-2">
      <template v-for="(label, i) in STEP_LABELS" :key="label">
        <div class="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors"
            :class="
              i + 1 < step
                ? 'bg-(--color-accent-strong) text-(--color-fill-text)'
                : i + 1 === step
                  ? 'border-2 border-(--color-accent) text-(--color-accent-text)'
                  : 'border border-(--color-border) text-(--color-text-muted)'
            "
          >
            <AppIcon v-if="i + 1 < step" name="check" :size="14" />
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span class="text-center text-[11px] text-balance text-(--color-text-muted)">{{ label }}</span>
        </div>
        <div v-if="i < STEP_LABELS.length - 1" class="mb-4 h-px flex-1 bg-(--color-border)" />
      </template>
    </div>

    <div
      ref="stepCard"
      tabindex="-1"
      class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/40 sm:p-5"
    >
      <SalonInfoStep
        v-if="step === 1"
        v-model="form.salonInfo"
        :category-options="categoryOptions"
        :categories-loading="categoriesLoading"
        :categories-error="categoriesError"
        :city-options="cityOptions"
        :cities-loading="citiesLoading"
        :cities-error="citiesError"
        @retry-categories="loadCategories"
        @retry-cities="loadCities"
      />
      <ScheduleStep v-else-if="step === 2" v-model="form.hours" :invalid-weekdays="hoursValidation.invalid" />
      <FirstServiceStep v-else v-model="form.service" />
    </div>

    <p v-if="submitError" class="mt-3 flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
      <AppIcon name="warning" :size="16" class="shrink-0" />
      {{ submitError }}
    </p>

    <div class="mt-4 flex flex-wrap justify-between gap-3">
      <AppButton v-if="step > 1" type="button" variant="secondary" @click="back">
        قبلی
      </AppButton>
      <AppButton v-if="step < 3" data-testid="wizard-next" type="button" class="ms-auto" :disabled="!canGoNext" @click="next">
        بعدی
      </AppButton>
      <AppButton
        v-else
        data-testid="wizard-submit"
        type="button"
        class="ms-auto"
        :disabled="!isServiceValid || submitting"
        :loading="submitting"
        @click="submit"
      >
        {{ submitting ? 'در حال ثبت…' : 'ثبت و ارسال برای بررسی' }}
      </AppButton>
    </div>

    <p v-if="disabledHint && !submitting" data-testid="disabled-hint" class="mt-2 text-end text-xs text-(--color-text-muted)">
      {{ disabledHint }}
    </p>
  </div>
</template>
