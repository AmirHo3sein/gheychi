<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useApi } from '@/composables/useApi'
import { useSessionStore, type SessionUser } from '@/stores/session'
import { CODE_EXPIRED_MESSAGE, CODE_REJECTED_MESSAGE, describeAuthError, formatCountdown } from '@/utils/auth-errors'
import { toEnglishDigits, toPersianDigits } from '@/utils/digits'
import { sanitizeRedirect } from '@/utils/safe-redirect'

const router = useRouter()
const route = useRoute()
const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code'>('phone')
// Iranian keyboards/IMEs commonly default to Persian numerals -- typing them into a plain
// ref would look correct on screen but fail the API's ASCII-only /^09\d{9}$/ check.
// Normalizing on write means every read (the request body, the OTP-step confirmation label)
// sees plain ASCII regardless of which numeral set was actually typed.
const phoneRaw = ref('')
const phone = computed({
  get: () => phoneRaw.value,
  set: (v: string) => { phoneRaw.value = toEnglishDigits(v) },
})
const code = ref('')
const submitting = ref(false)
const formError = ref('')

// The code lives 120s (OtpService.OTP_TTL_SEC, reported by the API as expiresInSec so this
// screen never hardcodes its own copy). Without a visible expiry the 401 for a timed-out
// code reads as "you mistyped it", and the user retypes the same correct digits.
const codeExpiresIn = ref(0)
let expiryTimer: ReturnType<typeof setInterval> | undefined
// Only claim anything about expiry when the API actually told us the TTL. Deriving
// "expired" from a missing/zero field would make an API that predates expiresInSec (or any
// response we couldn't parse) render an immediate, false "your code expired" the moment the
// step opens -- strictly worse than saying nothing about expiry at all.
const codeTtlKnown = ref(false)
const codeExpired = computed(() => step.value === 'code' && codeTtlKnown.value && codeExpiresIn.value <= 0)

function startExpiryCountdown(seconds: number) {
  clearInterval(expiryTimer)
  codeTtlKnown.value = seconds > 0
  codeExpiresIn.value = seconds
  if (!codeTtlKnown.value) return
  expiryTimer = setInterval(() => {
    codeExpiresIn.value -= 1
    if (codeExpiresIn.value <= 0) clearInterval(expiryTimer)
  }, 1000)
}
onUnmounted(() => clearInterval(expiryTimer))

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<{ expiresInSec: number }>(
    '/auth/request-otp',
    { method: 'POST', body: { phone: phone.value }, silent: true },
  )
  submitting.value = false
  if (error) {
    formError.value = describeAuthError(error, 'شماره موبایل نامعتبر است')
    return
  }
  code.value = ''
  step.value = 'code'
  startExpiryCountdown(data?.expiresInSec ?? 0)
}

async function verifyOtp() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<{ user: SessionUser }>(
    '/auth/verify-otp',
    { method: 'POST', body: { phone: phone.value, code: code.value }, silent: true },
  )
  submitting.value = false
  if (error || !data) {
    formError.value = error ? describeAuthError(error, CODE_REJECTED_MESSAGE) : CODE_REJECTED_MESSAGE
    return
  }

  session.setUser(data.user)
  // Back to where a session expiry interrupted the owner -- only ever an in-app path.
  await router.push(sanitizeRedirect(route.query.redirect) ?? '/')
}
</script>

<template>
  <!-- One card, two panes from lg: the brand pane (mascot, wordmark, what the panel is for)
       beside the form pane. Below lg the brand pane collapses to a compact header above the
       form, so a phone sees the form without scrolling past artwork. The card is bounded
       (max-w-4xl), not a pair of full-viewport halves -- the earlier 50/50 split left two
       large empty rectangles on a wide screen. -->
  <main class="login-bg relative flex min-h-dvh items-center justify-center p-4 sm:p-6">
    <!-- Decoration lives in its own absolutely-positioned, clipped layer: putting
         `overflow-hidden` on the scrolling parent instead would clip the card itself on a
         short viewport, where the composition needs to scroll rather than be cut off. -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="mesh-a absolute -top-32 -start-24 h-96 w-96 rounded-full bg-(--color-accent) opacity-40 blur-3xl" />
      <div class="mesh-b absolute -bottom-32 -end-24 h-96 w-96 rounded-full bg-(--color-accent-deep) opacity-25 blur-3xl" />
    </div>

    <div class="relative w-full max-w-md lg:max-w-4xl">
      <div
        class="login-stagger relative z-10 grid overflow-hidden rounded-3xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-lg) lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]"
        style="animation-delay: 0s"
      >
        <!-- Brand pane. In RTL the first grid column is the right-hand one. -->
        <section class="relative flex flex-col items-center bg-(--color-surface-subtle) px-6 pt-6 pb-4 text-center lg:items-start lg:px-10 lg:pt-10 lg:pb-0 lg:text-start" aria-label="قیچی، پنل سالن">
          <div class="flex items-center gap-3">
            <img src="/brand-icon.png" alt="" class="h-11 w-11 shrink-0 rounded-xl shadow-(--shadow-sm)" />
            <div class="text-start leading-tight">
              <p class="text-2xl font-extrabold text-(--color-text)">قیچی</p>
              <p class="text-sm font-semibold text-(--color-accent-text-strong)">پنل سالن</p>
            </div>
          </div>

          <p class="mt-4 hidden max-w-sm text-sm leading-7 text-(--color-text-muted) lg:block">
            نوبت‌ها، خدمات و مشتریان سالن‌تان را از یک جا مدیریت کنید.
          </p>
          <ul class="mt-5 hidden space-y-2.5 text-sm text-(--color-text) lg:block">
            <li class="flex items-center gap-2.5">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--color-surface-card) text-(--color-accent-text-strong)"><AppIcon name="bookings" :size="16" /></span>
              پذیرش و مدیریت درخواست‌های نوبت
            </li>
            <li class="flex items-center gap-2.5">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--color-surface-card) text-(--color-accent-text-strong)"><AppIcon name="services" :size="16" /></span>
              خدمات، قیمت‌ها و ساعات کاری
            </li>
            <li class="flex items-center gap-2.5">
              <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-(--color-surface-card) text-(--color-accent-text-strong)"><AppIcon name="customers" :size="16" /></span>
              مشتریان، نظرات و درآمد سالن
            </li>
          </ul>

          <!-- Decorative. webp first (32KB) with the PNG as fallback; sized so the waving
               character sits on the pane's bottom edge at lg and stays small on phones. -->
          <picture class="pointer-events-none mt-4 block self-center lg:mt-auto lg:pt-6">
            <source srcset="/mascot-full.webp" type="image/webp" />
            <img src="/mascot-full.png" alt="" width="501" height="900" class="h-36 w-auto lg:h-72" decoding="async" />
          </picture>
        </section>

        <!-- Form pane -->
        <section class="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
          <div>
            <h1 class="text-2xl font-bold text-(--color-text)">{{ step === 'phone' ? 'ورود به پنل سالن' : 'کد تایید را وارد کنید' }}</h1>
            <p class="mt-1.5 text-sm leading-6 text-(--color-text-muted)">
              {{ step === 'phone' ? 'شماره موبایلی را که با آن سالن را ثبت کرده‌اید وارد کنید تا کد تایید برایتان پیامک شود.' : 'کد پیامک‌شده را وارد کنید.' }}
            </p>
          </div>

          <div class="mt-6">
            <form v-if="step === 'phone'" data-testid="phone-form" class="space-y-4" @submit.prevent="requestOtp">
              <AppInput
                data-testid="phone-input"
                v-model="phone"
                type="tel"
                dir="ltr"
                icon="phone"
                label="شماره موبایل"
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                autocomplete="tel"
              />
              <p v-if="formError" role="alert" aria-live="polite" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
                <AppIcon name="warning" :size="16" class="shrink-0" />
                {{ formError }}
              </p>
              <AppButton type="submit" data-testid="submit-phone" :loading="submitting" size="lg" block>
                {{ submitting ? 'در حال ارسال…' : 'دریافت کد تایید' }}
              </AppButton>
            </form>

            <form v-else data-testid="code-form" class="space-y-4" @submit.prevent="verifyOtp">
              <AppInput
                data-testid="code-input"
                v-model="code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                dir="ltr"
                align="center"
                icon="lock"
                class="tnum"
                :label="`کد تایید ارسال‌شده به ${toPersianDigits(phone)}`"
                placeholder="------"
              />
              <!-- The code's real remaining life, so a timed-out code isn't mistaken for a typo. -->
              <p
                v-if="codeTtlKnown && !codeExpired"
                data-testid="code-expiry"
                aria-live="polite"
                class="tnum text-center text-sm text-(--color-text-muted)"
              >
                اعتبار کد: {{ formatCountdown(codeExpiresIn) }}
              </p>
              <p
                v-else-if="codeExpired"
                data-testid="code-expired"
                role="alert"
                class="text-center text-sm font-semibold text-(--tone-danger-text)"
              >
                {{ CODE_EXPIRED_MESSAGE }}
              </p>
              <p v-if="formError" role="alert" aria-live="polite" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
                <AppIcon name="warning" :size="16" class="shrink-0" />
                {{ formError }}
              </p>
              <AppButton type="submit" data-testid="submit-code" :loading="submitting" size="lg" block>
                {{ submitting ? 'در حال بررسی…' : 'ورود' }}
              </AppButton>
              <AppButton type="button" variant="ghost" block @click="step = 'phone'">
                ویرایش شماره موبایل
              </AppButton>
            </form>
          </div>

          <p class="mt-6 text-xs leading-5 text-(--color-text-muted)">
            هنوز سالن‌تان را ثبت نکرده‌اید؟ با همین شماره وارد شوید؛ ثبت سالن قدم بعدی است.
          </p>
        </section>
      </div>

      <p class="login-stagger mt-6 text-center text-xs text-(--color-text-muted)" style="animation-delay: 0.15s">
        © {{ toPersianDigits(new Date().getFullYear()) }} قیچی
      </p>
    </div>
  </main>
</template>
