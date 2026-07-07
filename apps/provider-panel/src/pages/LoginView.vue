<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
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
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm space-y-4">
      <h1 class="text-xl font-bold text-center">ورود به پنل مدیریت آرایشگاه</h1>

      <form v-if="step === 'phone'" data-testid="phone-form" class="space-y-3" @submit.prevent="requestOtp">
        <input
          data-testid="phone-input"
          v-model="phone"
          type="tel"
          placeholder="شماره موبایل"
          class="w-full rounded-lg border p-3"
        />
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3">
          دریافت کد
        </button>
      </form>

      <form v-else data-testid="code-form" class="space-y-3" @submit.prevent="verifyOtp">
        <input
          data-testid="code-input"
          v-model="code"
          type="text"
          inputmode="numeric"
          placeholder="کد تایید"
          class="w-full rounded-lg border p-3"
        />
        <p v-if="formError" class="text-sm text-red-600">{{ formError }}</p>
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3">
          ورود
        </button>
      </form>
    </div>
  </div>
</template>
