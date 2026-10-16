<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useSessionStore } from '@/stores/session'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { CODE_EXPIRED_MESSAGE, CODE_REJECTED_MESSAGE, describeAuthError, formatCountdown } from '@/utils/auth-errors'
import { toEnglishDigits, toPersianDigits } from '@/utils/digits'

const { apiFetch } = useApi()
const session = useSessionStore()
const router = useRouter()

// Iranian keyboards/IMEs commonly default to Persian numerals -- typing them into a plain
// ref would look correct on screen but fail the API's ASCII-only /^09\d{9}$/ check.
const phoneRaw = ref('')
const phone = computed({
  get: () => phoneRaw.value,
  set: (v: string) => { phoneRaw.value = toEnglishDigits(v) },
})
const code = ref('')
const step = ref<'phone' | 'code'>('phone')
const errorMessage = ref('')
const submitting = ref(false)
const codeInputRef = ref<InstanceType<typeof AppInput> | null>(null)

// The code lives 120s (OtpService.OTP_TTL_SEC, reported by the API as expiresInSec rather
// than hardcoded per screen). Without a visible expiry the 401 for a timed-out code reads as
// "you mistyped it", so the admin retypes the same correct digits and fails again.
const codeExpiresIn = ref(0)
let expiryTimer: ReturnType<typeof setInterval> | undefined
// Only claim anything about expiry when the API actually told us the TTL -- otherwise a
// response without expiresInSec would render an immediate, false "your code expired".
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
  errorMessage.value = ''
  submitting.value = true
  const { data, error } = await apiFetch<{ expiresInSec: number }>('/auth/request-otp', {
    method: 'POST',
    body: { phone: phone.value },
    silent: true,
  })
  submitting.value = false
  if (error) {
    // Never surface error.message directly: the API's strings are English ('Too many OTP
    // requests'), which would land untranslated in this Persian-only UI, and a 429 rendered
    // as-is tells the admin nothing about the hour-long window they just hit.
    errorMessage.value = describeAuthError(error, 'شماره موبایل نامعتبر است')
    return
  }
  code.value = ''
  step.value = 'code'
  startExpiryCountdown(data?.expiresInSec ?? 0)
  await nextTick()
  codeInputRef.value?.$el?.querySelector('input')?.focus()
}

function backToPhoneStep() {
  step.value = 'phone'
  errorMessage.value = ''
  code.value = ''
}

// Shown back to the admin on the code step -- Persian digits for display only; `phone` itself
// stays ASCII for the API.
const phoneDisplay = computed(() => toPersianDigits(phone.value))
// Solar Hijri year in Persian digits, not the Gregorian "2026" the footer used to show.
const copyrightYear = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(new Date())

async function verifyOtp() {
  errorMessage.value = ''
  submitting.value = true
  const { data, error } = await apiFetch<{
    user: { id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }
  }>('/auth/verify-otp', {
    method: 'POST',
    body: { phone: phone.value, code: code.value },
    silent: true,
  })
  submitting.value = false
  if (error || !data) {
    errorMessage.value = error ? describeAuthError(error, CODE_REJECTED_MESSAGE) : CODE_REJECTED_MESSAGE
    return
  }
  session.setUser(data.user)
  await router.push('/')
}
</script>

<template>
  <!-- Admin login: a deliberately quiet, single-card composition. The customer and provider
       logins carry the full waving mascot; here the character only peeks over the card's top
       edge at a small size, and the card itself leads with the brand lockup and a plain
       statement of who this screen is for. -->
  <main class="login-bg relative flex min-h-dvh items-center justify-center px-4 py-10">
    <div class="relative w-full max-w-[400px]">
      <!-- Mascot behind the card: earlier in the DOM and unpositioned, while the card is
           `relative z-10` with an opaque background, so the negative margin tucks the
           character's lower half behind the card's top edge. -->
      <div class="login-stagger flex justify-center" style="animation-delay: 0s" aria-hidden="true">
        <picture>
          <source srcset="/mascot-full.webp" type="image/webp" />
          <img src="/mascot-full.png" alt="" width="501" height="900" class="-mb-14 h-36 w-auto sm:h-40" />
        </picture>
      </div>

      <div
        class="login-stagger relative z-10 rounded-[20px] border border-(--color-border) bg-(--color-surface-card) p-6 shadow-(--shadow-md) sm:p-8"
        style="animation-delay: 0.06s"
      >
        <div class="flex items-center gap-3">
          <img src="/brand-icon.png" alt="" width="44" height="44" class="h-11 w-11 shrink-0 rounded-xl" />
          <div class="min-w-0 leading-tight">
            <p class="text-xl font-black text-(--color-text)">قیچی</p>
            <p class="text-sm font-medium text-(--color-text-muted)">پنل مدیریت</p>
          </div>
        </div>

        <div class="mt-6">
          <h1 class="text-xl font-bold text-(--color-text)">ورود مدیران</h1>
          <p class="mt-1.5 text-sm leading-6 text-(--color-text-muted)">
            {{ step === 'phone' ? 'شماره موبایل حساب مدیریتی خود را وارد کنید تا کد یک‌بارمصرف برایتان پیامک شود.' : 'کد ۶ رقمی پیامک‌شده را وارد کنید.' }}
          </p>
        </div>

        <div class="mt-6">
          <form
            v-if="step === 'phone'"
            data-testid="phone-form"
            class="space-y-4"
            @submit.prevent="requestOtp"
          >
            <AppInput
              data-testid="phone-input"
              v-model="phone"
              type="tel"
              dir="ltr"
              icon="phone"
              label="شماره موبایل"
              autocomplete="tel"
              autofocus
            />
            <AppButton type="submit" data-testid="submit-phone" :loading="submitting" size="lg" block>
              {{ submitting ? 'در حال ارسال…' : 'ارسال کد تایید' }}
            </AppButton>
          </form>

          <form v-else data-testid="code-form" class="space-y-4" @submit.prevent="verifyOtp">
            <AppInput
              ref="codeInputRef"
              data-testid="code-input"
              v-model="code"
              type="text"
              inputmode="numeric"
              dir="ltr"
              align="center"
              icon="lock"
              class="tnum"
              :label="`کد تایید ارسال‌شده به ${phoneDisplay}`"
              placeholder="------"
              autocomplete="one-time-code"
              :error="step === 'code' ? errorMessage : ''"
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
            <AppButton type="submit" data-testid="submit-code" :loading="submitting" size="lg" block>
              {{ submitting ? 'در حال بررسی…' : 'تایید و ورود' }}
            </AppButton>
            <AppButton type="button" variant="ghost" block @click="backToPhoneStep">
              ویرایش شماره موبایل
            </AppButton>
          </form>

          <p
            v-if="errorMessage"
            role="alert"
            aria-live="polite"
            class="mt-4 flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)"
          >
            <AppIcon name="warning" :size="16" class="shrink-0" />
            {{ errorMessage }}
          </p>
        </div>

        <!-- Every admin mutation is written to the audit log (AuditInterceptor), so this is a
             factual statement, not a deterrent prop. -->
        <p class="mt-6 flex items-start gap-2 border-t border-(--color-border-soft) pt-4 text-xs leading-5 text-(--color-text-muted)">
          <AppIcon name="shield" :size="16" class="mt-0.5 shrink-0 text-(--color-accent-text)" />
          این بخش فقط برای مدیران مجاز است. اقدامات مدیریتی در تاریخچهٔ اقدامات ثبت می‌شود.
        </p>
      </div>

      <p class="login-stagger mt-6 text-center text-xs text-(--color-text-muted)" style="animation-delay: 0.12s">
        © {{ copyrightYear }} قیچی
      </p>
    </div>
  </main>
</template>
