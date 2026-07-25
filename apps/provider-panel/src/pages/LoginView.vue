<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useApi, type ApiError } from '@/composables/useApi'
import { useSessionStore, type SessionUser } from '@/stores/session'

const router = useRouter()
const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code'>('phone')
const phone = ref('')
const code = ref('')
const submitting = ref(false)
const formError = ref('')

/**
 * Maps an ApiError to an honest Persian message: a dead network (status 0) and a
 * rate limit (429) are real, distinct causes and shouldn't be presented as bad input.
 * `invalidMessage` is used for genuine validation failures (and any other status).
 */
function describeError(error: ApiError, invalidMessage: string): string {
  if (error.status === 0) {
    return 'اتصال اینترنت برقرار نیست. اتصال خود را بررسی کنید و دوباره تلاش کنید.'
  }
  if (error.status === 429) {
    return 'درخواست‌های زیادی ارسال شده است. چند لحظه صبر کنید و دوباره تلاش کنید.'
  }
  if (error.status >= 500) {
    return 'خطایی در سرور رخ داده است. لطفاً چند لحظه دیگر دوباره تلاش کنید.'
  }
  return invalidMessage
}

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { error } = await apiFetch('/auth/request-otp', { method: 'POST', body: { phone: phone.value }, silent: true })
  submitting.value = false
  if (error) {
    formError.value = describeError(error, 'شماره موبایل نامعتبر است')
    return
  }
  step.value = 'code'
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
    formError.value = error ? describeError(error, 'کد وارد شده اشتباه است') : 'کد وارد شده اشتباه است'
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
