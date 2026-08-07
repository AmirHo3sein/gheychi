<script setup lang="ts">
import type { SessionUser } from '~/stores/session'
import { toEnglishDigits } from '../utils/digits'
import { GENDER_OPTIONS } from '../utils/gender-map'

definePageMeta({ layout: 'bare' })

const { apiFetch } = useApi()
const session = useSessionStore()
const route = useRoute()
const { rebindToCurrentUser: rebindPushSubscription } = usePushSubscription()

const step = ref<'phone' | 'code' | 'profile'>('phone')
// Iranian keyboards/IMEs commonly default to Persian numerals -- typing them into a plain
// ref would look correct on screen but fail the API's ASCII-only /^09\d{9}$/ check.
const phoneRaw = ref('')
const phone = computed({
  get: () => phoneRaw.value,
  set: (v: string) => { phoneRaw.value = toEnglishDigits(v) },
})
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

// Resend is gated on the CODE'S OWN LIFETIME, not a separate shorter cooldown. This screen
// used to run two independent clocks -- a 45s resend cooldown beside the API's 120s expiry --
// so the button re-armed while the current code was still perfectly valid, and the user was
// shown two unrelated countdowns for one situation. Resending then also spends one of the
// three-per-hour server budget for a code that had not expired. One deadline now: while the
// code lives there is nothing to resend, and the moment it dies resend unlocks. The TTL still
// comes from the API (expiresInSec) rather than a hardcoded 120 that could drift from
// OtpService.
const codeExpiresIn = ref(0)
let expiryTimer: ReturnType<typeof setInterval> | undefined
// Only reached when the API reports no TTL: expiry is then unknown (so nothing is claimed
// about it on screen), but resend still needs some floor rather than being free to spam.
const RESEND_FALLBACK_SEC = 45
// Only claim anything about expiry when the API actually told us the TTL -- otherwise a
// response without expiresInSec would render an immediate, false "your code expired".
const codeTtlKnown = ref(false)

// The limiter allows only 3 requests per hour while the cooldown re-arms every 45s, so the
// UI used to invite a user to burn every attempt in ~90 seconds and then locked them out for
// the rest of the hour with no warning. The API now reports what's left so we can say so.
const resendsRemaining = ref<number | null>(null)

const codeExpired = computed(() => step.value === 'code' && codeTtlKnown.value && codeExpiresIn.value <= 0)

function startExpiryCountdown(seconds: number) {
  clearInterval(expiryTimer)
  codeTtlKnown.value = seconds > 0
  // With no TTL from the API, codeTtlKnown stays false so no expiry claim is rendered -- but
  // the countdown still runs, because it is also what gates the resend button.
  codeExpiresIn.value = seconds > 0 ? seconds : RESEND_FALLBACK_SEC
  expiryTimer = setInterval(() => {
    codeExpiresIn.value -= 1
    if (codeExpiresIn.value <= 0) clearInterval(expiryTimer)
  }, 1000)
}

onUnmounted(() => clearInterval(expiryTimer))

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
  <!-- One centred composition, identical in structure across all three apps (provider-panel
       and admin-panel carry the same markup with their own copy) -- login is the one screen
       every product shares, so it is the one that should read the same. -->
  <main class="login-bg relative flex min-h-dvh items-center justify-center p-6">
    <!-- Decoration lives in its own absolutely-positioned, clipped layer: putting
         `overflow-hidden` on the scrolling parent instead would clip the card itself on a
         short viewport, where this app's tallest step (profile) needs to scroll. -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div class="mesh-a absolute -top-32 -start-24 h-96 w-96 rounded-full bg-(--color-accent) opacity-40 blur-3xl" />
      <div class="mesh-b absolute -bottom-32 -end-24 h-96 w-96 rounded-full bg-(--color-accent-deep) opacity-30 blur-3xl" />
    </div>

    <div class="relative w-full max-w-md">
      <!-- The mascot stands BEHIND the card: it is earlier in the DOM and unpositioned, while
           the card below is `relative z-10` with an opaque background, so the negative margin
           tucks the character's legs neatly behind the card's top edge instead of leaving it
           floating in its own empty band. -->
      <div class="login-stagger relative -mb-20 flex justify-center" style="animation-delay: 0s">
        <div class="login-glow pointer-events-none absolute bottom-4 h-40 w-56 opacity-70" aria-hidden="true" />
        <img src="/mascot-full.png" alt="" class="relative h-60 w-auto" />
      </div>

      <div class="login-stagger relative z-10" style="animation-delay: 0.1s">
        <BaseCard padding="lg">
          <!-- Inside the card, matching the two panels -- above it, this row would land in
               the band the mascot overlaps and collide with the character. A link, unlike
               the panels': this is the public site, so the mark doubles as the way back to
               the storefront. -->
          <NuxtLink to="/" class="mb-5 flex items-center justify-center gap-2.5">
            <img src="/brand-icon.png" alt="" class="h-9 w-9 shrink-0 rounded-xl" />
            <span class="text-base font-bold">قیچی</span>
          </NuxtLink>

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
                  class="font-medium text-(--color-accent-text) transition-opacity disabled:cursor-not-allowed disabled:text-(--color-text-muted) disabled:opacity-70"
                  :disabled="codeExpiresIn > 0 || resendsRemaining === 0"
                  @click="requestOtp"
                >
                  {{ codeExpiresIn > 0 ? `ارسال مجدد کد (${formatCountdown(codeExpiresIn)})` : 'ارسال مجدد کد' }}
                </button>
              </p>
              <!-- Resends are capped at 3/hour server-side, and resend only unlocks once the
                   current code has expired, so the budget can no longer be burnt in a couple
                   of minutes. The warning still earns its place: three codes is three codes,
                   and being told at the point of spending the last one beats discovering the
                   hour-long lockout afterwards. `null` = none issued this session, so say
                   nothing. -->
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
              <!-- The old disabled <option value=""> is AppSelect's placeholder now, not an
                   option: it was never choosable, only how '' (nothing picked) renders. -->
              <AppSelect v-model="gender" label="جنسیت" required :options="GENDER_OPTIONS" :searchable="false" />
              <BaseButton type="submit" :loading="submitting" block size="lg">تکمیل ثبت‌نام</BaseButton>
            </form>
          </Transition>

          <p v-if="formError" class="mt-4 flex items-center justify-center gap-1.5 text-sm text-(--color-danger)">
            <BaseIcon name="alert-circle" :size="16" />
            {{ formError }}
          </p>
        </BaseCard>

        <p class="login-stagger mt-6 text-center text-xs text-(--color-text-muted)" style="animation-delay: 0.2s">
          © {{ new Date().getFullYear() }} قیچی
        </p>
      </div>
    </div>
  </main>
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
