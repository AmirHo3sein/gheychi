<script setup lang="ts">
import type { SessionUser } from '~/stores/session'

definePageMeta({ layout: 'bare' })

const { apiFetch } = useApi()
const session = useSessionStore()
const route = useRoute()

const step = ref<'phone' | 'code' | 'profile'>('phone')
const phone = ref('')
const code = ref('')
const name = ref('')
const gender = ref<'female' | 'male' | ''>('')
const submitting = ref(false)
const formError = ref('')

// Referral-code entry lives here, on the OTP step, NOT on the later 'profile' step
// (which only shows for isNewUser) and NOT as a post-registration prompt, even though
// both of those read more naturally against the design doc's literal "ask after
// registration" suggestion. Reasoning: POST /auth/verify-otp is the one and only call
// that creates the account and can redeem a referral code server-side (see
// ReferralsService.applyReferralAtRegistration -- it only ever runs inside that same
// registration transaction). By the time the 'profile' step -- or any post-login page
// -- renders, verify-otp has already returned and the account already exists; there is
// no second endpoint that can retroactively attach a code to an already-created user.
// So the field has to be part of THIS step's request body, submitted together with the
// OTP code, even though this step is shown to existing users too (harmless: the API
// only ever reads `referralCode` on the isNew branch of registration, per R2 -- an
// existing user submitting one is a silent no-op, response omits `referralStatus`
// entirely). Kept collapsed behind a toggle by default so it doesn't clutter the login
// step for the common (non-referred, or already-registered) case.
const showReferralCode = ref(false)
const referralCode = ref('')

// A share link minted by GET /referrals/my-code looks like `/login?ref=<code>` (see
// ReferralsService.buildShareUrl) -- prefill and reveal the field when someone arrives
// via that link so they don't have to notice the toggle themselves.
const refParam = route.query.ref
if (typeof refParam === 'string' && refParam.trim()) {
  referralCode.value = refParam.trim()
  showReferralCode.value = true
}

const STEP_ORDER = ['phone', 'code', 'profile'] as const
const stepIndex = computed(() => STEP_ORDER.indexOf(step.value))

const RESEND_COOLDOWN_SEC = 45
const resendCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | undefined

function startCooldown() {
  resendCooldown.value = RESEND_COOLDOWN_SEC
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0) clearInterval(cooldownTimer)
  }, 1000)
}
onUnmounted(() => clearInterval(cooldownTimer))

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { error } = await apiFetch('/auth/request-otp', { method: 'POST', body: { phone: phone.value }, silent: true })
  submitting.value = false
  if (error) { formError.value = 'شماره موبایل نامعتبر است'; return }
  step.value = 'code'
  startCooldown()
}

const REFERRAL_STATUS_MESSAGE: Record<string, string> = {
  applied: 'کد معرف با موفقیت ثبت شد',
  invalid_code: 'کد معرف وارد شده معتبر نیست',
  referral_type_disabled: 'کد معرف ثبت شد؛ پاداش‌های معرفی به‌زودی فعال می‌شود',
}

async function verifyOtp() {
  submitting.value = true
  formError.value = ''
  const body: Record<string, unknown> = { phone: phone.value, code: code.value }
  const trimmedReferralCode = referralCode.value.trim()
  if (trimmedReferralCode) body.referralCode = trimmedReferralCode

  const { data, error } = await apiFetch<{
    user: SessionUser
    isNewUser: boolean
    referralStatus?: 'applied' | 'invalid_code' | 'referral_type_disabled'
  }>('/auth/verify-otp', { method: 'POST', body, silent: true })
  submitting.value = false
  if (error || !data) { formError.value = 'کد وارد شده اشتباه است'; return }

  if (data.referralStatus) useToast().push(REFERRAL_STATUS_MESSAGE[data.referralStatus] ?? '')

  session.setUser(data.user)
  if (!data.user.name || !data.user.gender) {
    step.value = 'profile'
  } else {
    await navigateTo('/')
  }
}

async function completeProfile() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<SessionUser>(
    '/auth/profile',
    { method: 'PATCH', body: { name: name.value, gender: gender.value } },
  )
  submitting.value = false
  if (error || !data) { formError.value = 'ثبت اطلاعات با خطا مواجه شد'; return }
  session.setUser(data)
  await navigateTo('/')
}

function goBackToPhone() {
  step.value = 'phone'
  code.value = ''
  formError.value = ''
}

const STEP_LABEL: Record<typeof step.value, string> = {
  phone: 'ورود با شماره موبایل',
  code: 'کد تایید را وارد کنید',
  profile: 'چند قدم تا شروع',
}
const STEP_HINT: Record<typeof step.value, string> = {
  phone: 'برای ورود یا ساخت حساب، شماره موبایل خود را وارد کنید.',
  code: 'کد ۶ رقمی پیامک‌شده را وارد کنید.',
  profile: 'برای تکمیل ثبت‌نام، این اطلاعات را وارد کنید.',
}
</script>

<template>
  <div class="min-h-screen lg:flex">
    <!-- Brand panel: hidden on mobile, the left visual half from lg breakpoint up -->
    <div class="relative hidden overflow-hidden bg-(--color-accent) lg:flex lg:w-1/2 lg:flex-col lg:justify-between lg:p-12">
      <div
        class="pointer-events-none absolute -end-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        class="pointer-events-none absolute -start-16 bottom-0 h-72 w-72 rounded-full bg-black/10 blur-3xl"
        aria-hidden="true"
      />

      <NuxtLink to="/" class="relative z-10 flex items-center gap-2 text-white">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
          <BaseIcon name="sparkles" :size="20" />
        </span>
        <span class="text-lg font-bold">آرایشگاه</span>
      </NuxtLink>

      <div class="relative z-10 space-y-4 text-white">
        <h2 class="max-w-md text-3xl font-bold leading-relaxed">
          رزرو نوبت آرایشگاه، ساده و سریع
        </h2>
        <p class="max-w-sm text-white/80">
          بهترین سالن‌های زیبایی نزدیک خودت رو پیدا کن، نوبت بگیر و دیگه نگران معطلی نباش.
        </p>
      </div>

      <p class="relative z-10 text-sm text-white/60">© {{ new Date().getFullYear() }} آرایشگاه</p>
    </div>

    <!-- Form panel -->
    <div class="flex min-h-screen flex-1 items-center justify-center p-6">
      <div class="w-full max-w-sm">
        <!-- Mobile-only brand mark -->
        <div class="mb-8 flex items-center justify-center gap-2 lg:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-accent) text-white">
            <BaseIcon name="sparkles" :size="20" />
          </span>
          <span class="text-lg font-bold">آرایشگاه</span>
        </div>

        <BaseCard padding="lg">
          <!-- Step indicator -->
          <div class="mb-6 flex items-center gap-1.5" aria-hidden="true">
            <span
              v-for="(s, i) in STEP_ORDER"
              :key="s"
              class="h-1.5 flex-1 rounded-full transition-colors duration-300"
              :class="i <= stepIndex ? 'bg-(--color-accent)' : 'bg-(--color-border)'"
            />
          </div>

          <div class="mb-6">
            <div class="flex items-center gap-2">
              <button
                v-if="step === 'code'"
                type="button"
                aria-label="بازگشت"
                class="-ms-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
                @click="goBackToPhone"
              >
                <BaseIcon name="chevron-forward" :size="20" />
              </button>
              <h1 class="text-xl font-bold">{{ STEP_LABEL[step] }}</h1>
            </div>
            <p class="mt-1.5 text-sm text-(--color-text-muted)">{{ STEP_HINT[step] }}</p>
          </div>

          <Transition name="step-fade" mode="out-in">
            <!-- Every step's <form> gets its own :key. Without one, Vue's v-if/v-else-if patch
            can reuse the same underlying <form> DOM node across a step transition (same tag,
            same position) rather than destroying and recreating it -- observed via CI trace
            investigation as a contributing factor in an intermittent CI-only failure where a
            later step's submit click didn't reliably run its intended @submit.prevent handler.
            Keying each form forces a clean unmount/remount (and fresh listener) on every
            transition, which is the correct pattern regardless of that specific investigation's
            outcome (see the CI flakiness note in CLAUDE.md's Known Gaps for the full context). -->
            <form v-if="step === 'phone'" key="phone" class="space-y-4" @submit.prevent="requestOtp">
              <BaseInput
                v-model="phone"
                type="tel"
                inputmode="tel"
                icon="phone"
                label="شماره موبایل"
                placeholder="09xxxxxxxxx"
                required
                autofocus
              />
              <BaseButton type="submit" :loading="submitting" block size="lg">دریافت کد</BaseButton>
            </form>

            <form v-else-if="step === 'code'" key="code" class="space-y-4" @submit.prevent="verifyOtp">
              <BaseInput
                v-model="code"
                inputmode="numeric"
                :maxlength="6"
                icon="shield"
                label="کد تایید"
                placeholder="کد ۶ رقمی"
                align="center"
                required
                autofocus
              />
              <button
                v-if="!showReferralCode"
                type="button"
                data-testid="show-referral-code"
                class="mx-auto block text-center text-sm text-(--color-text-muted) underline decoration-dotted underline-offset-4"
                @click="showReferralCode = true"
              >
                کد معرف دارید؟
              </button>
              <BaseInput
                v-else
                v-model="referralCode"
                data-testid="referral-code-input"
                type="text"
                label="کد معرف (اختیاری)"
                placeholder="کد معرف"
              />
              <BaseButton type="submit" :loading="submitting" block size="lg">تایید و ورود</BaseButton>
              <p class="text-center text-sm text-(--color-text-muted)">
                <button
                  type="button"
                  class="font-medium text-(--color-accent) transition-opacity disabled:cursor-not-allowed disabled:text-(--color-text-muted) disabled:opacity-70"
                  :disabled="resendCooldown > 0"
                  @click="requestOtp"
                >
                  {{ resendCooldown > 0 ? `ارسال مجدد کد (${resendCooldown})` : 'ارسال مجدد کد' }}
                </button>
              </p>
            </form>

            <form v-else key="profile" class="space-y-4" @submit.prevent="completeProfile">
              <BaseInput v-model="name" type="text" icon="user" label="نام" placeholder="نام شما" required autofocus />
              <BaseSelect v-model="gender" label="جنسیت" required>
                <option value="" disabled>انتخاب کنید</option>
                <option value="female">زن</option>
                <option value="male">مرد</option>
              </BaseSelect>
              <BaseButton type="submit" :loading="submitting" block size="lg">تکمیل ثبت‌نام</BaseButton>
            </form>
          </Transition>

          <p v-if="formError" class="mt-4 flex items-center justify-center gap-1.5 text-sm text-(--color-danger)">
            <BaseIcon name="alert-circle" :size="16" />
            {{ formError }}
          </p>
        </BaseCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-fade-enter-active,
.step-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.step-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.step-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
