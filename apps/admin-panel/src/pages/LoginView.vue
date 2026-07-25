<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useSessionStore } from '@/stores/session'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'

const { apiFetch } = useApi()
const session = useSessionStore()
const router = useRouter()

const phone = ref('')
const code = ref('')
const step = ref<'phone' | 'code'>('phone')
const errorMessage = ref('')
const submitting = ref(false)
const codeInputRef = ref<InstanceType<typeof AppInput> | null>(null)

async function requestOtp() {
  errorMessage.value = ''
  submitting.value = true
  const { error } = await apiFetch('/auth/request-otp', {
    method: 'POST',
    body: { phone: phone.value },
    silent: true,
  })
  submitting.value = false
  if (error) {
    errorMessage.value = error.message
    return
  }
  step.value = 'code'
  await nextTick()
  codeInputRef.value?.$el?.querySelector('input')?.focus()
}

function backToPhoneStep() {
  step.value = 'phone'
  errorMessage.value = ''
  code.value = ''
}

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
    errorMessage.value = error?.message ?? 'کد وارد شده نامعتبر است'
    return
  }
  session.setUser(data.user)
  await router.push('/')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-(--color-surface-card) px-8 py-12 sm:px-16">
    <div class="mx-auto w-full max-w-sm">
      <div class="login-stagger flex items-center gap-2.5" style="animation-delay: 0s">
        <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-accent) text-lg font-black text-white">آ</div>
        <span class="text-sm font-bold text-(--color-text)">پنل مدیریت آرایشگاه</span>
      </div>

      <div class="login-stagger mt-10" style="animation-delay: 0.12s">
        <h1 class="text-2xl font-bold text-(--color-text)">خوش آمدید</h1>
        <p class="mt-1.5 text-sm text-(--color-text-muted)">برای ورود به پنل مدیریت، شماره موبایل خود را وارد کنید.</p>
      </div>

      <form
        v-if="step === 'phone'"
        data-testid="phone-form"
        class="login-stagger mt-8 space-y-4"
        style="animation-delay: 0.24s"
        @submit.prevent="requestOtp"
      >
        <AppInput
          data-testid="phone-input"
          v-model="phone"
          type="tel"
          dir="ltr"
          icon="phone"
          label="شماره موبایل"
          placeholder="شماره موبایل"
          autocomplete="tel"
          autofocus
        />
        <AppButton type="submit" data-testid="submit-phone" :loading="submitting" size="lg" block>
          {{ submitting ? 'در حال ارسال…' : 'ارسال کد تایید' }}
        </AppButton>
      </form>

      <form v-else data-testid="code-form" class="mt-8 space-y-4" @submit.prevent="verifyOtp">
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
          :label="`کد تایید ارسال‌شده به ${phone}`"
          placeholder="------"
          autocomplete="one-time-code"
          :error="step === 'code' ? errorMessage : ''"
        />
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
  </div>
</template>
