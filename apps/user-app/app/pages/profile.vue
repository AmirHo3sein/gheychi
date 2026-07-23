<script setup lang="ts">
interface FavoriteSalon { id: string; name: string; slug: string; city: string }

const session = useSessionStore()
const { apiFetch } = useApi()
const { supported: pushSupported, isSubscribed, refreshStatus, subscribe, unsubscribe } = usePushSubscription()

const favorites = ref<FavoriteSalon[]>([])
const name = ref(session.user?.name ?? '')
const gender = ref(session.user?.gender ?? 'female')
const savingProfile = ref(false)

onMounted(async () => {
  await refreshStatus()
  const { data } = await apiFetch<FavoriteSalon[]>('/favorites', { silent: true })
  favorites.value = data ?? []
})

async function saveProfile() {
  savingProfile.value = true
  const { data } = await apiFetch('/auth/profile', { method: 'PATCH', body: { name: name.value, gender: gender.value } })
  savingProfile.value = false
  if (data) session.setUser(data as typeof session.user)
}

async function togglePush() {
  if (isSubscribed.value) await unsubscribe()
  else await subscribe()
}

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' })
  session.setUser(null)
  await navigateTo('/login')
}
</script>

<template>
  <div class="p-4 space-y-6">
    <section class="space-y-2">
      <h1 class="text-lg font-bold">پروفایل</h1>
      <p class="text-sm">{{ session.user?.phone }}</p>
      <input v-model="name" type="text" placeholder="نام" class="w-full rounded-lg border p-2 text-sm" />
      <select v-model="gender" class="w-full rounded-lg border p-2 text-sm">
        <option value="female">زن</option>
        <option value="male">مرد</option>
      </select>
      <button type="button" :disabled="savingProfile" class="rounded-lg bg-(--color-accent) text-white px-4 py-2 text-sm" @click="saveProfile">
        ذخیره
      </button>
    </section>

    <section v-if="pushSupported" class="flex items-center justify-between">
      <span class="text-sm">اعلان‌های نوبت</span>
      <button type="button" class="rounded-full px-3 py-1 text-sm" :class="isSubscribed ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'" @click="togglePush">
        {{ isSubscribed ? 'فعال' : 'غیرفعال' }}
      </button>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">کیف پول</h2>
      <NuxtLink to="/account/wallet" class="block rounded-lg bg-(--color-surface-card) p-3 text-sm text-(--color-accent)">
        مشاهده موجودی و تراکنش‌ها
      </NuxtLink>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">دعوت از دوستان</h2>
      <NuxtLink to="/account/referral" class="block rounded-lg bg-(--color-surface-card) p-3 text-sm text-(--color-accent)">
        کد معرفی و دعوت‌های من
      </NuxtLink>
    </section>

    <section class="space-y-2">
      <h2 class="font-bold">سالن‌های ذخیره شده</h2>
      <p v-if="!favorites.length" class="text-sm">سالنی ذخیره نکرده‌اید</p>
      <NuxtLink v-for="salon in favorites" :key="salon.id" :to="`/salons/${salon.slug}`" class="block rounded-lg bg-(--color-surface-card) p-3 text-sm">
        {{ salon.name }} — {{ salon.city }}
      </NuxtLink>
    </section>

    <button type="button" class="text-sm text-(--color-ad)" @click="logout">خروج از حساب</button>
  </div>
</template>
