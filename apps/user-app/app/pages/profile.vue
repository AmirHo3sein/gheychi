<script setup lang="ts">
import { GENDER_OPTIONS } from '../utils/gender-map'

const session = useSessionStore()
const { apiFetch } = useApi()
const { supported: pushSupported, isSubscribed, refreshStatus, subscribe, unsubscribe } = usePushSubscription()
const { logout } = useLogout()
const { flags: featureFlags } = useFeatureFlags()

const name = ref(session.user?.name ?? '')
// Never default an UNSET gender to a value: this field decides which salons the user is
// shown at all (see toSearchGender/index.vue), so pre-answering it silently picks a whole
// product experience on the user's behalf -- and, worse, makes the profile look complete
// while the account still has gender = null server-side. '' matches no option, so AppSelect
// shows its placeholder, exactly like login.vue's profile step.
const gender = ref<'female' | 'male' | ''>(session.user?.gender ?? '')
const savingProfile = ref(false)
const nameError = ref('')
const genderError = ref('')

onMounted(refreshStatus)

// Mirrors the API's name-length constraint (2-100 chars) so an invalid name never leaves
// the client -- otherwise the server's class-validator error message (English) would reach
// the user through the generic apiFetch toast in an all-Persian UI.
function validateName(): boolean {
  const trimmed = name.value.trim()
  if (trimmed.length < 2 || trimmed.length > 100) {
    nameError.value = 'نام باید بین ۲ تا ۱۰۰ نویسه باشد'
    return false
  }
  nameError.value = ''
  return true
}

// Reachable now that an unset gender stays unset: the API's own @IsIn(['female','male'])
// would reject '' with an English message through the generic toast.
function validateGender(): boolean {
  if (gender.value === '') {
    genderError.value = 'جنسیت را انتخاب کنید'
    return false
  }
  genderError.value = ''
  return true
}

watch(name, () => {
  if (nameError.value) nameError.value = ''
})

watch(gender, () => {
  if (genderError.value) genderError.value = ''
})

async function saveProfile() {
  // Both run, not short-circuited -- a user with two invalid fields should see both errors.
  const validName = validateName()
  const validGender = validateGender()
  if (!validName || !validGender) return
  savingProfile.value = true
  const { data } = await apiFetch('/auth/profile', { method: 'PATCH', body: { name: name.value, gender: gender.value } })
  savingProfile.value = false
  if (data) {
    session.setUser(data as typeof session.user)
    useToast().push('تغییرات ذخیره شد')
  }
}

async function togglePush() {
  if (isSubscribed.value) await unsubscribe()
  else await subscribe()
}

// First letter of the name for the avatar; falls back to a generic user glyph while unnamed.
const initial = computed(() => Array.from((session.user?.name ?? '').trim())[0] ?? '')

interface Shortcut { to: string; title: string; subtitle: string; icon: 'wallet' | 'clock' | 'gift' | 'sparkles' | 'heart'; testid?: string }
const shortcuts = computed<Shortcut[]>(() => [
  { to: '/account/wallet', title: 'کیف پول', subtitle: 'موجودی و تراکنش‌ها', icon: 'wallet' },
  { to: '/account/activity', title: 'تاریخچه فعالیت', subtitle: 'نوبت‌ها، تراکنش‌ها، نظرات و پاداش‌ها در یک نگاه', icon: 'clock' },
  { to: '/account/referral', title: 'دعوت از دوستان', subtitle: 'کد معرفی و دعوت‌های من', icon: 'gift' },
  ...(featureFlags.value.beautyGuideEnabled
    ? [{ to: '/account/beauty-guides', title: 'راهنماهای زیبایی', subtitle: 'استایل‌هایی که تحلیل کرده‌اید', icon: 'sparkles' as const, testid: 'profile-beauty-guides-link' }]
    : []),
  { to: '/account/favorites', title: 'سالن‌های ذخیره‌شده', subtitle: 'سالن‌هایی که با قلب نشان کرده‌اید', icon: 'heart' },
])

useSeoMeta({ title: 'پروفایل — قیچی' })
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6 p-4 lg:p-6">
    <!-- Who this account is, at a glance. The page used to open with a bare "پروفایل" heading and
         a raw phone number straight into a form. -->
    <section class="flex items-center gap-3">
      <span
        class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-(--color-accent-soft) text-xl font-bold text-(--color-accent-text)"
        aria-hidden="true"
      >
        <template v-if="initial">{{ initial }}</template>
        <BaseIcon v-else name="user" :size="24" />
      </span>
      <div class="min-w-0">
        <h1 class="truncate text-xl font-bold text-(--color-text)">{{ session.user?.name || 'پروفایل' }}</h1>
        <p dir="ltr" class="text-end text-sm text-(--color-text-muted)">{{ session.user?.phone }}</p>
      </div>
    </section>

    <!-- The account shortcuts as ONE grouped list. They were five separate white cards, each
         under its own heading that merely repeated what the card said (a "کیف پول" heading over
         a card reading "مشاهده موجودی و تراکنش‌ها"). One surface with dividers is shorter, scans
         faster and reads as a menu rather than a pile of boxes. -->
    <nav aria-label="میانبرهای حساب">
      <ul class="divide-y divide-(--color-border) overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)">
        <li v-for="item in shortcuts" :key="item.to">
          <NuxtLink
            :to="item.to"
            :data-testid="item.testid"
            class="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-(--color-surface-subtle) active:bg-(--color-surface-subtle)"
          >
            <BaseIcon :name="item.icon" :size="20" class="text-(--color-accent-text)" />
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-(--color-text)">{{ item.title }}</span>
              <span class="block text-xs text-(--color-text-muted)">{{ item.subtitle }}</span>
            </span>
            <BaseIcon name="chevron-back" :size="18" class="text-(--color-text-muted)" />
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <section class="space-y-3">
      <h2 class="font-bold text-(--color-text)">اطلاعات حساب</h2>
      <form class="space-y-4" @submit.prevent="saveProfile">
        <BaseInput v-model="name" type="text" label="نام" placeholder="نام" :maxlength="100" required :error="nameError" />
        <!-- The old disabled <option value=""> is AppSelect's placeholder now, not an option:
             it was never a choosable value, only the "nothing picked yet" rendering of ''. -->
        <AppSelect v-model="gender" label="جنسیت" required :error="genderError" :options="GENDER_OPTIONS" :searchable="false" />
        <BaseButton type="submit" :loading="savingProfile">ذخیره</BaseButton>
      </form>
    </section>

    <section v-if="pushSupported" class="flex items-center justify-between gap-3">
      <span>
        <span class="block text-sm font-medium text-(--color-text)">اعلان‌های نوبت</span>
        <span class="block text-xs text-(--color-text-muted)">یادآوری و تغییر وضعیت نوبت‌ها</span>
      </span>
      <button
        type="button"
        :aria-pressed="isSubscribed"
        class="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-colors"
        :class="isSubscribed ? 'bg-(--color-accent-soft) text-(--color-text)' : 'bg-(--color-surface-subtle) text-(--color-text-muted)'"
        @click="togglePush"
      >
        {{ isSubscribed ? 'فعال' : 'غیرفعال' }}
      </button>
    </section>

    <!-- Quiet destructive action at the end, not a solid red button competing with everything
         above it. -->
    <div class="border-t border-(--color-border) pt-4 text-center">
      <BaseButton variant="ghost" class="!text-(--color-danger)" @click="logout">
        <template #icon><BaseIcon name="logout" :size="18" /></template>
        خروج از حساب
      </BaseButton>
    </div>
  </div>
</template>
