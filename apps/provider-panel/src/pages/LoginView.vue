<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useApi } from '@/composables/useApi'
import { useSessionStore, type SessionUser } from '@/stores/session'
import { CODE_EXPIRED_MESSAGE, CODE_REJECTED_MESSAGE, describeAuthError, formatCountdown } from '@/utils/auth-errors'

const router = useRouter()
const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code'>('phone')
const phone = ref('')
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
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--color-surface) p-6">
    <div class="mesh-a pointer-events-none absolute -top-20 -start-10 h-72 w-72 rounded-full bg-(--color-accent) opacity-20 blur-[90px]" />
    <div class="mesh-b pointer-events-none absolute -bottom-24 -end-10 h-72 w-72 rounded-full bg-(--tone-warning-text) opacity-20 blur-[90px]" />

    <div class="relative w-full max-w-sm">
      <div class="login-stagger flex flex-col items-center text-center" style="animation-delay: 0s">
        <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-(--color-accent) text-xl font-black text-white shadow-(--shadow-sm)">
          آ
        </div>
        <h1 class="text-xl font-bold text-(--color-text)">ورود به پنل مدیریت</h1>
        <p class="mt-1 text-sm text-(--color-text-muted)">مدیریت نوبت‌ها، خدمات و درآمد آرایشگاه شما</p>
      </div>

      <div class="login-stagger mt-8 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 shadow-(--shadow-sm)" style="animation-delay: 0.12s">
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
  </div>
</template>
