<script setup lang="ts">
import type { SessionUser } from '~/stores/session'

definePageMeta({ layout: 'bare' })

const { apiFetch } = useApi()
const session = useSessionStore()
const route = useRoute()
const { rebindToCurrentUser: rebindPushSubscription } = usePushSubscription()

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

// Expiry is a SEPARATE clock from the resend cooldown above, and conflating the two is
// exactly the trap this screen used to set: the only visible number was the 45s cooldown,
// which reads as "time left on my code" while the code actually lives 120s. A user who
// waited past that got "wrong code" for digits that were correct but stale. Both clocks are
// now shown for what they are, and the TTL comes from the API (expiresInSec) rather than a
// hardcoded 120 here that could silently drift from OtpService.
const codeExpiresIn = ref(0)
let expiryTimer: ReturnType<typeof setInterval> | undefined
// Only claim anything about expiry when the API actually told us the TTL -- otherwise a
// response without expiresInSec would render an immediate, false "your code expired".
const codeTtlKnown = ref(false)

// The limiter allows only 3 requests per hour while the cooldown re-arms every 45s, so the
// UI used to invite a user to burn every attempt in ~90 seconds and then locked them out for
// the rest of the hour with no warning. The API now reports what's left so we can say so.
const resendsRemaining = ref<number | null>(null)

const codeExpired = computed(() => step.value === 'code' && codeTtlKnown.value && codeExpiresIn.value <= 0)

function startCooldown() {
  resendCooldown.value = RESEND_COOLDOWN_SEC
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    resendCooldown.value -= 1
    if (resendCooldown.value <= 0) clearInterval(cooldownTimer)
  }, 1000)
}

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

onUnmounted(() => {
  clearInterval(cooldownTimer)
  clearInterval(expiryTimer)
})

async function requestOtp() {
  submitting.value = true
  formError.value = ''
  const { data, error } = await apiFetch<{ expiresInSec: number; resendsRemaining: number }>(
    '/auth/request-otp',
    { method: 'POST', body: { phone: phone.value }, silent: true },
  )
  submitting.value = false
  if (error) {
    // Only a genuine 4xx-validation failure means the number itself is wrong; a 429 or a
    // dead network must not be reported as bad input (see describeAuthError).
    formError.value = describeAuthError(error, 'شماره موبایل نامعتبر است')
    return
  }
  code.value = ''
  step.value = 'code'
  startCooldown()
  startExpiryCountdown(data?.expiresInSec ?? 0)
  resendsRemaining.value = data?.resendsRemaining ?? null
}

// Only 'applied' means a `referrals` row was actually written. Every other status is a
// no-row outcome, and since a code can only ever be redeemed inside the registration
// transaction itself (see the comment on showReferralCode above), nothing can attach it
// later -- so none of them may imply the code was kept for a reward "coming soon". The
// disabled case in particular is the DEFAULT for early users (every reward type ships
// disabled), which is exactly why saying "ثبت شد" there was a promise nobody could keep.
const REFERRAL_STATUS_MESSAGE: Record<string, string> = {
  applied: 'کد معرف با موفقیت ثبت شد',
  invalid_code: 'کد معرف وارد شده معتبر نیست',
  referral_type_disabled: 'کد معرف ثبت نشد؛ پاداش‌های معرفی هنوز فعال نشده است',
  referrer_limit_reached: 'کد معرف ثبت نشد؛ سهمیه دعوت این معرف تکمیل شده است',
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
    referralStatus?: 'applied' | 'invalid_code' | 'referral_type_disabled' | 'referrer_limit_reached'
  }>('/auth/verify-otp', { method: 'POST', body, silent: true })
  submitting.value = false
  if (error || !data) {
    // 401 here covers wrong / expired / burned-by-retries alike -- the API doesn't
    // distinguish them, so CODE_REJECTED_MESSAGE names both causes rather than asserting
    // the code was simply mistyped.
    formError.value = error ? describeAuthError(error, CODE_REJECTED_MESSAGE) : CODE_REJECTED_MESSAGE
    return
  }

  if (data.referralStatus) useToast().push(REFERRAL_STATUS_MESSAGE[data.referralStatus] ?? '')

  session.setUser(data.user)
  // A push subscription belongs to the BROWSER, not to an account: on a shared device the
  // push_subscriptions row still points at whoever logged in here last, so rebind it to the
  // account that just signed in -- otherwise the previous user's appointment notifications
  // keep arriving on this device. Not awaited: the POST already carries the session cookie
  // verify-otp just set, and login must not wait on (or fail because of) a service worker.
  void rebindPushSubscription()
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
        <span class="text-lg font-bold">قیچی</span>
      </NuxtLink>

      <div class="relative z-10 space-y-4 text-white">
        <h2 class="max-w-md text-3xl font-bold leading-relaxed">
          رزرو نوبت آرایشگاه، ساده و سریع
        </h2>
        <p class="max-w-sm text-white/80">
          بهترین سالن‌های زیبایی نزدیک خودت رو پیدا کن، نوبت بگیر و دیگه نگران معطلی نباش.
        </p>
      </div>

      <p class="relative z-10 text-sm text-white/60">© {{ new Date().getFullYear() }} قیچی</p>
    </div>

    <!-- Form panel -->
    <div class="flex min-h-screen flex-1 items-center justify-center p-6">
      <div class="w-full max-w-sm">
        <!-- Mobile-only brand mark -->
        <div class="mb-8 flex items-center justify-center gap-2 lg:hidden">
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-(--color-accent) text-white">
            <BaseIcon name="sparkles" :size="20" />
          </span>
          <span class="text-lg font-bold">قیچی</span>
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
              <!-- The code's real remaining life. Without this the only number on screen was
                   the resend cooldown, which a user reasonably reads as their code's expiry. -->
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
                class="text-center text-sm font-semibold text-(--color-danger)"
              >
                {{ CODE_EXPIRED_MESSAGE }}
              </p>
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
                  :disabled="resendCooldown > 0 || resendsRemaining === 0"
                  @click="requestOtp"
                >
                  {{ resendCooldown > 0 ? `ارسال مجدد کد (${resendCooldown})` : 'ارسال مجدد کد' }}
                </button>
              </p>
              <!-- Resends are capped at 3/hour server-side. Saying so up front is the whole
                   point: the cooldown re-arms every 45s, so without this a user could burn
                   every attempt in a minute and a half and only find out by being locked
                   out. `null` = we haven't issued one this session yet, so say nothing. -->
              <p
                v-if="resendsRemaining !== null && resendsRemaining <= 1"
                data-testid="resend-limit-warning"
                aria-live="polite"
                class="text-center text-xs text-(--color-text-muted)"
              >
                {{
                  resendsRemaining === 0
                    ? 'سهمیه درخواست کد تمام شد. تا یک ساعت آینده امکان درخواست کد جدید نیست.'
                    : 'این آخرین درخواست کد مجاز شما در یک ساعت گذشته است.'
                }}
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
