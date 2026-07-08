<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useSessionStore } from '@/stores/session'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

const { apiFetch } = useApi()
const session = useSessionStore()
const router = useRouter()

const phone = ref('')
const code = ref('')
const step = ref<'phone' | 'code'>('phone')
const errorMessage = ref('')
const submitting = ref(false)

// A handful of large, calm floating glyphs -- curated hero decoration for the visual
// panel, not a dense particle field. Fixed positions/timings, not random.
interface Glyph {
  icon: IconName
  top: string
  left: string
  size: number
  rot: string
  delay: string
}
const GLYPHS: Glyph[] = [
  { icon: 'scissors', top: '14%', left: '18%', size: 64, rot: '-18deg', delay: '0s' },
  { icon: 'sparkles', top: '68%', left: '12%', size: 40, rot: '10deg', delay: '1.2s' },
  { icon: 'palette', top: '20%', left: '72%', size: 52, rot: '14deg', delay: '2.4s' },
  { icon: 'droplet', top: '78%', left: '68%', size: 36, rot: '-8deg', delay: '0.6s' },
  { icon: 'brush', top: '48%', left: '84%', size: 44, rot: '-22deg', delay: '3s' },
]

const FEATURES: { icon: IconName; label: string }[] = [
  { icon: 'salons', label: 'بررسی و تایید آرایشگاه‌ها' },
  { icon: 'reviews', label: 'تعدیل نظرات کاربران' },
  { icon: 'config', label: 'کنترل کامل تنظیمات پلتفرم' },
]

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
  <div class="flex min-h-screen bg-(--color-surface-card)">
    <!-- Form panel (right side, RTL reading-start) -->
    <div class="flex w-full flex-col justify-center px-8 py-12 sm:px-16 lg:w-[46%] lg:px-20">
      <div class="mx-auto w-full max-w-sm">
        <div class="login-stagger flex items-center gap-2.5" style="animation-delay: 0s">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-accent) text-lg font-black text-white">آ</div>
          <span class="text-sm font-bold text-(--color-text)">پنل مدیریت آرایشگاه</span>
        </div>

        <div class="login-stagger mt-10" style="animation-delay: 0.12s">
          <h1 class="text-2xl font-bold text-(--color-text)">خوش آمدید</h1>
          <p class="mt-1.5 text-sm text-(--color-muted)">برای ورود به پنل مدیریت، شماره موبایل خود را وارد کنید.</p>
        </div>

        <form
          v-if="step === 'phone'"
          data-testid="phone-form"
          class="login-stagger mt-8 space-y-4"
          style="animation-delay: 0.24s"
          @submit.prevent="requestOtp"
        >
          <div>
            <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">شماره موبایل</label>
            <div class="relative">
              <AppIcon name="phone" :size="17" class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-(--color-muted)" />
              <input
                v-model="phone"
                data-testid="phone-input"
                type="tel"
                dir="ltr"
                placeholder="شماره موبایل"
                class="w-full rounded-xl border border-(--color-border) py-3 ps-11 pe-3 text-left text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            data-testid="submit-phone"
            :disabled="submitting"
            class="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {{ submitting ? 'در حال ارسال…' : 'ارسال کد تایید' }}
          </button>
        </form>

        <form v-else data-testid="code-form" class="mt-8 space-y-4" @submit.prevent="verifyOtp">
          <div>
            <label class="mb-1.5 block text-sm font-semibold text-(--color-text)">کد تایید ارسال‌شده به {{ phone }}</label>
            <div class="relative">
              <AppIcon name="lock" :size="17" class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-(--color-muted)" />
              <input
                v-model="code"
                data-testid="code-input"
                type="text"
                inputmode="numeric"
                dir="ltr"
                placeholder="------"
                class="tnum w-full rounded-xl border border-(--color-border) py-3 ps-11 pe-3 text-center text-lg tracking-[0.5em]"
              />
            </div>
          </div>
          <button
            type="submit"
            data-testid="submit-code"
            :disabled="submitting"
            class="w-full rounded-xl bg-(--color-accent) py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {{ submitting ? 'در حال بررسی…' : 'تایید و ورود' }}
          </button>
          <button type="button" class="w-full text-center text-xs text-(--color-muted) hover:text-(--color-accent)" @click="step = 'phone'">
            ویرایش شماره موبایل
          </button>
        </form>

        <p v-if="errorMessage" class="mt-4 flex items-center gap-2 rounded-xl bg-(--tone-danger-bg) p-3 text-sm text-(--tone-danger-text)">
          <AppIcon name="warning" :size="16" class="shrink-0" />
          {{ errorMessage }}
        </p>
      </div>
    </div>

    <!-- Visual panel (left side) -->
    <div class="relative hidden flex-1 items-center justify-center overflow-hidden bg-(--color-surface) lg:flex">
      <div class="mesh-a pointer-events-none absolute -top-24 left-1/4 h-[30rem] w-[30rem] rounded-full bg-(--color-accent) opacity-25 blur-[100px]" />
      <div class="mesh-b pointer-events-none absolute bottom-[-6rem] right-[-4rem] h-96 w-96 rounded-full bg-amber-300 opacity-30 blur-[100px]" />
      <div class="mesh-c pointer-events-none absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-rose-300 opacity-25 blur-[100px]" />

      <div
        v-for="(g, i) in GLYPHS"
        :key="i"
        class="login-glyph pointer-events-none absolute text-(--color-accent) opacity-[0.16]"
        :style="{ top: g.top, left: g.left, animationDelay: g.delay, '--rot': g.rot }"
      >
        <AppIcon :name="g.icon" :size="g.size" />
      </div>

      <div class="relative max-w-md px-10 text-center">
        <h2 class="login-stagger text-3xl font-black leading-[1.5] text-(--color-text)" style="animation-delay: 0.1s">
          مدیریت حرفه‌ای
          <br />
          پلتفرم آرایشگاهی
        </h2>
        <div class="login-underline mx-auto mt-3 h-1 w-16 rounded-full bg-(--color-accent)" />
        <p class="login-stagger mt-4 text-sm leading-7 text-(--color-muted)" style="animation-delay: 0.2s">
          از یک نقطه، آرایشگاه‌ها را تایید کنید، نظرات را مدیریت کنید و تنظیمات کل پلتفرم آرایشگاه را در دست بگیرید.
        </p>

        <div class="login-stagger mt-9 space-y-3" style="animation-delay: 0.32s">
          <div
            v-for="f in FEATURES"
            :key="f.label"
            class="flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-surface-card) px-4 py-3 text-right shadow-(--shadow-panel)"
          >
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--tone-info-bg) text-(--color-accent)">
              <AppIcon :name="f.icon" :size="17" />
            </div>
            <span class="text-sm font-semibold text-(--color-text)">{{ f.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
