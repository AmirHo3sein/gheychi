<script setup lang="ts">
interface FavoriteSalon { id: string; name: string; slug: string; city: string }

const session = useSessionStore()
const { apiFetch } = useApi()
const { supported: pushSupported, isSubscribed, refreshStatus, subscribe, unsubscribe } = usePushSubscription()

const favorites = ref<FavoriteSalon[]>([])
const name = ref(session.user?.name ?? '')
// Never default an UNSET gender to a value: this field decides which salons the user is
// shown at all (see toSearchGender/index.vue), so pre-answering it silently picks a whole
// product experience on the user's behalf -- and, worse, makes the profile look complete
// while the account still has gender = null server-side. '' renders as the placeholder
// option, exactly like login.vue's profile step.
const gender = ref<'female' | 'male' | ''>(session.user?.gender ?? '')
const savingProfile = ref(false)
const nameError = ref('')
const genderError = ref('')

onMounted(async () => {
  // refreshStatus() (push-subscription status) and the favorites fetch are independent --
  // no need to serialize them.
  const [, favoritesResult] = await Promise.all([
    refreshStatus(),
    apiFetch<FavoriteSalon[]>('/favorites', { silent: true }),
  ])
  favorites.value = favoritesResult.data ?? []
})

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

// Unbinding this browser's push subscription must happen BEFORE the session cookie is
// cleared -- DELETE /push/subscribe is scoped to { endpoint, userId }, so afterwards the
// row would be stranded owned by the user who just left and the next person to log in on
// this device would keep receiving their appointment notifications. It is also time-boxed
// rather than merely try/caught: `navigator.serviceWorker.ready` never rejects, it simply
// never resolves when there's no active registration, and a user must always be able to
// log out regardless of what the service worker is doing.
const PUSH_UNBIND_TIMEOUT_MS = 2000

async function logout() {
  await Promise.race([
    unsubscribe().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, PUSH_UNBIND_TIMEOUT_MS)),
  ])
  await apiFetch('/auth/logout', { method: 'POST' })
  session.setUser(null)
  await navigateTo('/login')
}

useSeoMeta({ title: 'پروفایل — آرایشگاه' })
</script>

<template>
  <div class="p-4 space-y-6">
    <section class="space-y-3">
      <h1 class="text-lg font-bold">پروفایل</h1>
      <p class="text-sm text-(--color-text-muted)">{{ session.user?.phone }}</p>
      <form class="space-y-4" @submit.prevent="saveProfile">
        <BaseInput v-model="name" type="text" label="نام" placeholder="نام" :maxlength="100" required :error="nameError" />
        <BaseSelect v-model="gender" label="جنسیت" required :error="genderError">
          <option value="" disabled>انتخاب کنید</option>
          <option value="female">زن</option>
          <option value="male">مرد</option>
        </BaseSelect>
        <BaseButton type="submit" :loading="savingProfile">ذخیره</BaseButton>
      </form>
    </section>

    <section v-if="pushSupported" class="flex items-center justify-between">
      <span class="text-sm">اعلان‌های نوبت</span>
      <button
        type="button"
        :aria-pressed="isSubscribed"
        class="rounded-full px-3 py-1 text-sm font-medium transition-colors"
        :class="isSubscribed ? 'bg-(--color-accent-soft) text-(--color-text)' : 'bg-(--color-surface-subtle) text-(--color-text-muted)'"
        @click="togglePush"
      >
        {{ isSubscribed ? 'فعال' : 'غیرفعال' }}
      </button>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">کیف پول</h2>
      <NuxtLink to="/account/wallet" class="block">
        <BaseCard class="flex items-center justify-between text-(--color-text)">
          <span class="text-sm">مشاهده موجودی و تراکنش‌ها</span>
          <BaseIcon name="chevron-back" :size="18" class="text-(--color-text-muted)" />
        </BaseCard>
      </NuxtLink>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">دعوت از دوستان</h2>
      <NuxtLink to="/account/referral" class="block">
        <BaseCard class="flex items-center justify-between text-(--color-text)">
          <span class="text-sm">کد معرفی و دعوت‌های من</span>
          <BaseIcon name="chevron-back" :size="18" class="text-(--color-text-muted)" />
        </BaseCard>
      </NuxtLink>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">سالن‌های ذخیره شده</h2>
      <p v-if="!favorites.length" class="text-sm text-(--color-text-muted)">سالنی ذخیره نکرده‌اید</p>
      <div v-else class="space-y-2">
        <NuxtLink v-for="salon in favorites" :key="salon.id" :to="`/salons/${salon.slug}`" class="block">
          <BaseCard class="text-sm text-(--color-text)">{{ salon.name }} — {{ salon.city }}</BaseCard>
        </NuxtLink>
      </div>
    </section>

    <div class="pt-2 text-center">
      <BaseButton variant="danger" @click="logout">خروج از حساب</BaseButton>
    </div>
  </div>
</template>
