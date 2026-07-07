<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useSessionStore } from '@/stores/session'

const { apiFetch } = useApi()
const session = useSessionStore()
const router = useRouter()

const phone = ref('')
const code = ref('')
const step = ref<'phone' | 'code'>('phone')
const errorMessage = ref('')

async function requestOtp() {
  errorMessage.value = ''
  const { error } = await apiFetch('/auth/request-otp', {
    method: 'POST',
    body: { phone: phone.value },
    silent: true,
  })
  if (error) {
    errorMessage.value = error.message
    return
  }
  step.value = 'code'
}

async function verifyOtp() {
  errorMessage.value = ''
  const { data, error } = await apiFetch<{
    user: { id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }
  }>('/auth/verify-otp', {
    method: 'POST',
    body: { phone: phone.value, code: code.value },
    silent: true,
  })
  if (error || !data) {
    errorMessage.value = error?.message ?? 'کد وارد شده نامعتبر است'
    return
  }
  session.setUser(data.user)
  await router.push('/')
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
    <h1 class="text-xl font-bold">ورود مدیر</h1>

    <form v-if="step === 'phone'" data-testid="phone-form" class="space-y-3" @submit.prevent="requestOtp">
      <input
        v-model="phone"
        data-testid="phone-input"
        type="tel"
        placeholder="شماره موبایل"
        class="w-full rounded-lg border p-3"
      />
      <button type="submit" class="w-full rounded-lg bg-(--color-accent) p-3 text-white">ارسال کد</button>
    </form>

    <form v-else data-testid="code-form" class="space-y-3" @submit.prevent="verifyOtp">
      <input
        v-model="code"
        data-testid="code-input"
        type="text"
        placeholder="کد تایید"
        class="w-full rounded-lg border p-3"
      />
      <button type="submit" class="w-full rounded-lg bg-(--color-accent) p-3 text-white">تایید</button>
    </form>

    <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
  </div>
</template>
