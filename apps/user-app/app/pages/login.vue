<script setup lang="ts">
import type { SessionUser } from '~/stores/session'

const { apiFetch } = useApi()
const session = useSessionStore()

const step = ref<'phone' | 'code' | 'profile'>('phone')
const phone = ref('')
const code = ref('')
const name = ref('')
const gender = ref<'female' | 'male' | ''>('')
const submitting = ref(false)
const formError = ref('')

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { error } = await apiFetch('/auth/request-otp', { method: 'POST', body: { phone: phone.value }, silent: true })
  submitting.value = false
  if (error) { formError.value = 'شماره موبایل نامعتبر است'; return }
  step.value = 'code'
}

async function verifyOtp() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<{ user: SessionUser; isNewUser: boolean }>(
    '/auth/verify-otp',
    { method: 'POST', body: { phone: phone.value, code: code.value }, silent: true },
  )
  submitting.value = false
  if (error || !data) { formError.value = 'کد وارد شده اشتباه است'; return }

  session.setUser(data.user)
  if (!data.user.name || !data.user.gender) {
    step.value = 'profile'
  } else {
    await navigateTo('/')
  }
}

async function completeProfile() {
  submitting.value = true
  const { data, error } = await apiFetch<SessionUser>(
    '/auth/profile',
    { method: 'PATCH', body: { name: name.value, gender: gender.value } },
  )
  submitting.value = false
  if (error || !data) return
  session.setUser(data)
  await navigateTo('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm space-y-4">
      <h1 class="text-xl font-bold text-center">ورود به آرایشگاه</h1>

      <form v-if="step === 'phone'" class="space-y-3" @submit.prevent="requestOtp">
        <input v-model="phone" type="tel" placeholder="09xxxxxxxxx" class="w-full rounded-lg border p-3" required />
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
          دریافت کد
        </button>
      </form>

      <form v-else-if="step === 'code'" class="space-y-3" @submit.prevent="verifyOtp">
        <input v-model="code" inputmode="numeric" maxlength="6" placeholder="کد ۶ رقمی" class="w-full rounded-lg border p-3" required />
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
          تایید
        </button>
      </form>

      <form v-else class="space-y-3" @submit.prevent="completeProfile">
        <input v-model="name" type="text" placeholder="نام" class="w-full rounded-lg border p-3" required />
        <select v-model="gender" class="w-full rounded-lg border p-3" required>
          <option value="" disabled>جنسیت</option>
          <option value="female">زن</option>
          <option value="male">مرد</option>
        </select>
        <button type="submit" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-3 font-semibold">
          تکمیل ثبت‌نام
        </button>
      </form>

      <p v-if="formError" class="text-(--color-ad) text-sm text-center">{{ formError }}</p>
    </div>
  </div>
</template>
