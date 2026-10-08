<script setup lang="ts">
import type { NuxtError } from '#app'

// Nuxt's root error page: rendered for any unhandled error, including the createError() calls
// the salon / booking / blog pages throw for a missing record (and for SSR failures), where
// the visitor would otherwise get Nuxt's English default page. Deliberately standalone --
// it does NOT use <NuxtLayout>: if the error came from a layout, middleware or the session
// probe, depending on any of them here would crash the error page itself.
const props = defineProps<{ error: NuxtError }>()

const isNotFound = computed(() => props.error?.statusCode === 404)
const isForbidden = computed(() => props.error?.statusCode === 403)

const heading = computed(() => {
  if (isNotFound.value) return 'صفحه‌ای که دنبالش بودید پیدا نشد'
  if (isForbidden.value) return 'اجازه دیدن این صفحه را ندارید'
  return 'مشکلی پیش آمد'
})
const description = computed(() => {
  if (isNotFound.value) return 'ممکن است نشانی را اشتباه وارد کرده باشید یا این صفحه دیگر وجود نداشته باشد.'
  if (isForbidden.value) return 'برای دیدن این صفحه باید با حساب مناسب وارد شوید.'
  return 'خطایی در بارگذاری این صفحه رخ داد. چند لحظه دیگر دوباره تلاش کنید یا به صفحه اصلی برگردید.'
})

// clearError({ redirect }) resets the error state AND navigates, so the visitor lands on a
// working page instead of re-rendering this one.
function go(path: string) {
  return clearError({ redirect: path })
}

useSeoMeta({
  title: () => heading.value,
  robots: 'noindex, nofollow',
})
</script>

<template>
  <main class="flex min-h-dvh flex-col items-center justify-center gap-6 bg-(--color-surface) p-6 text-center text-(--color-text)">
    <NuxtLink to="/" class="flex items-center gap-2.5" aria-label="قیچی — صفحه اصلی" @click.prevent="go('/')">
      <img src="/brand-icon.png" alt="" class="h-10 w-10 shrink-0 rounded-xl" />
      <span class="text-lg font-bold">قیچی</span>
    </NuxtLink>

    <div class="max-w-md space-y-3" role="alert" data-testid="error-page">
      <p v-if="isNotFound" class="tnum text-5xl font-extrabold text-(--color-accent-text)" aria-hidden="true">۴۰۴</p>
      <h1 class="text-xl font-bold" data-testid="error-heading">{{ heading }}</h1>
      <p class="text-sm leading-7 text-(--color-text-muted)">{{ description }}</p>
    </div>

    <div class="flex w-full max-w-xs flex-col gap-2">
      <BaseButton block size="lg" data-testid="error-home" @click="go('/')">بازگشت به خانه</BaseButton>
      <BaseButton variant="secondary" block data-testid="error-salons" @click="go('/salons')">سالن‌های زیبایی</BaseButton>
    </div>
  </main>
</template>
