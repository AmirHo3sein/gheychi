<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useSessionStore, type SessionUser } from '@/stores/session'

const router = useRouter()
const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code'>('phone')
const phone = ref('')
const code = ref('')
const submitting = ref(false)
const formError = ref('')

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { error } = await apiFetch('/auth/request-otp', { method: 'POST', body: { phone: phone.value }, silent: true })
  submitting.value = false
  if (error) {
    formError.value = 'شماره موبایل نامعتبر است'
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
    formError.value = 'کد وارد شده اشتباه است'
    return
  }

  session.setUser(data.user)
  await router.push('/')
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-(--color-surface) p-6">
    <div class="mesh-a pointer-events-none absolute -top-20 -right-10 h-72 w-72 rounded-full bg-(--color-accent) opacity-20 blur-[90px]" />
    <div class="mesh-b pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-amber-300 opacity-20 blur-[90px]" />

    <div class="relative w-full max-w-sm">
      <div class="login-stagger flex flex-col items-center text-center" style="animation-delay: 0s">
        <div class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-(--color-accent) text-xl font-black text-white shadow-(--shadow-panel)">
          آ
        </div>
        <h1 class="text-xl font-bold text-(--color-text)">ورود به پنل مدیریت</h1>
        <p class="mt-1 text-sm text-(--color-muted)">مدیریت نوبت‌ها، خدمات و درآمد آرایشگاه شما</p>
      </div>

      <div class="login-stagger mt-8 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 shadow-(--shadow-panel)" style="animation-delay: 0.12s">
        <form v-if="step === 'phone'" data-testid="phone-form" class="space-y-4" @submit.prevent="requestOtp">
          <div>
            <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">شماره موبایل</label>
            <div class="relative">
              <AppIcon name="phone" :size="17" class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-(--color-muted)" />
              <input
                data-testid="phone-input"
                v-model="phone"
                type="tel"
                dir="ltr"
                placeholder="شماره موبایل"
                class="w-full rounded-xl border border-(--color-border) py-3 ps-11 pe-3 text-left text-sm"
              />
            </div>
          </div>
          <p v-if="formError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
            <AppIcon name="warning" :size="16" class="shrink-0" />
            {{ formError }}
          </p>
          <button
            type="submit"
            data-testid="submit-phone"
            :disabled="submitting"
            class="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {{ submitting ? 'در حال ارسال…' : 'دریافت کد تایید' }}
          </button>
        </form>

        <form v-else data-testid="code-form" class="space-y-4" @submit.prevent="verifyOtp">
          <div>
            <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">کد تایید ارسال‌شده به {{ phone }}</label>
            <div class="relative">
              <AppIcon name="lock" :size="17" class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-(--color-muted)" />
              <input
                data-testid="code-input"
                v-model="code"
                type="text"
                inputmode="numeric"
                dir="ltr"
                placeholder="------"
                class="tnum w-full rounded-xl border border-(--color-border) py-3 ps-11 pe-3 text-center text-lg tracking-[0.5em]"
              />
            </div>
          </div>
          <p v-if="formError" class="flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
            <AppIcon name="warning" :size="16" class="shrink-0" />
            {{ formError }}
          </p>
          <button
            type="submit"
            data-testid="submit-code"
            :disabled="submitting"
            class="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {{ submitting ? 'در حال بررسی…' : 'ورود' }}
          </button>
          <button type="button" class="w-full text-center text-xs text-(--color-muted) hover:text-(--color-accent)" @click="step = 'phone'">
            ویرایش شماره موبایل
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
