<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useApi } from '@/composables/useApi'
import { useSessionStore, type SessionUser } from '@/stores/session'
import { CODE_EXPIRED_MESSAGE, CODE_REJECTED_MESSAGE, describeAuthError, formatCountdown } from '@/utils/auth-errors'
import { toEnglishDigits } from '@/utils/digits'

const router = useRouter()
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
  await router.push('/')
}
</script>

<template>
  <!-- One centred composition, identical in structure across all three apps (user-app and
       admin-panel carry the same markup with their own copy) -- login is the one screen
       every product shares, so it is the one that should read the same. -->
  <main class="login-bg relative flex min-h-dvh items-center justify-center p-6">
    <!-- Decoration lives in its own absolutely-positioned, clipped layer: putting
         `overflow-hidden` on the scrolling parent instead would clip the card itself on a
         short viewport, where the composition needs to scroll rather than be cut off. -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="mesh-a absolute -top-32 -start-24 h-96 w-96 rounded-full bg-(--color-accent) opacity-40 blur-3xl" />
      <div class="mesh-b absolute -bottom-32 -end-24 h-96 w-96 rounded-full bg-(--color-accent-deep) opacity-30 blur-3xl" />
    </div>

    <div class="relative w-full max-w-md">
      <!-- The mascot stands BEHIND the card: it is earlier in the DOM and unpositioned, while
           the card below is `relative z-10` with an opaque background, so the negative margin
           tucks the character's legs neatly behind the card's top edge instead of leaving it
           floating in its own empty band. -->
      <div class="login-stagger relative -mb-20 flex justify-center" style="animation-delay: 0s">
        <div class="login-glow pointer-events-none absolute bottom-4 h-40 w-56 opacity-70" aria-hidden="true" />
        <img src="/mascot-full.png" alt="" class="relative h-60 w-auto" />
      </div>

      <div
        class="login-stagger relative z-10 rounded-3xl border border-(--color-border) bg-(--color-surface-card) p-7 shadow-(--shadow-lg) sm:p-8"
        style="animation-delay: 0.1s"
      >
        <div class="flex items-center justify-center gap-2.5">
          <img src="/brand-icon.png" alt="" class="h-9 w-9 shrink-0 rounded-xl" />
          <span class="text-base font-bold text-(--color-text)">پنل آرایشگاه قیچی</span>
        </div>

        <div class="mt-5 text-center">
          <h1 class="text-2xl font-bold text-(--color-text)">خوش آمدید</h1>
          <p class="mt-1.5 text-sm text-(--color-text-muted)">برای ورود به پنل آرایشگاه، شماره موبایل خود را وارد کنید.</p>
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
              placeholder="شماره موبایل"
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
              dir="ltr"
              align="center"
              icon="lock"
              class="tnum"
              :label="`کد تایید ارسال‌شده به ${phone}`"
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
      </div>

      <p class="login-stagger mt-6 text-center text-xs text-(--color-text-muted)" style="animation-delay: 0.2s">
        © {{ new Date().getFullYear() }} قیچی
      </p>
    </div>
  </main>
</template>
