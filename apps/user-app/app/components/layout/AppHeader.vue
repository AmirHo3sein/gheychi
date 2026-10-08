<script setup lang="ts">
const session = useSessionStore()
const { logout } = useLogout()
const { flags } = useFeatureFlags()
</script>

<template>
  <!-- One row at every width. The old header wrapped to two rows below ~370px (logo, then
       two text links, theme toggle and logout under it) and spent ~110px of a 640px-tall
       phone screen before any content. Phones now get the primary destinations from the
       bottom tab bar (BottomNav); this bar keeps only the brand, the theme toggle, and the
       one account action that matters when logged out (sign in). From `md` up the same
       destinations appear here as text links.
       Solid surface, no backdrop blur: PRODUCT.md's budget-Android constraint rules out
       effects that assume a capable GPU, and a sticky header is repainted on every scroll. -->
  <header class="sticky top-0 z-30 border-b border-(--color-border) bg-(--color-surface-card)">
    <div class="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
      <NuxtLink to="/" class="flex items-center gap-2" aria-label="قیچی — صفحه اصلی">
        <!-- Decorative: the wordmark beside it already names the brand to assistive tech. -->
        <img src="/brand-icon.png" alt="" class="h-8 w-8 shrink-0 rounded-xl" />
        <span class="font-bold">قیچی</span>
      </NuxtLink>

      <nav class="ms-4 hidden items-center gap-1 text-sm md:flex" aria-label="ناوبری اصلی">
        <NuxtLink
          to="/salons"
          class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
          active-class="!text-(--color-text) font-semibold"
        >
          سالن‌ها
        </NuxtLink>
        <NuxtLink
          v-if="session.isLoggedIn && flags.beautyGuideEnabled"
          to="/beauty-guide"
          class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
          active-class="!text-(--color-text) font-semibold"
        >
          راهنمای زیبایی
        </NuxtLink>
        <NuxtLink
          v-if="session.isLoggedIn"
          to="/bookings"
          class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
          active-class="!text-(--color-text) font-semibold"
        >
          نوبت‌های من
        </NuxtLink>
        <NuxtLink
          v-if="session.isLoggedIn"
          to="/profile"
          class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
          active-class="!text-(--color-text) font-semibold"
        >
          پروفایل
        </NuxtLink>
        <NuxtLink
          to="/blog"
          class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
          active-class="!text-(--color-text) font-semibold"
        >
          بلاگ
        </NuxtLink>
      </nav>

      <div class="ms-auto flex items-center gap-1">
        <ThemeToggle />
        <NuxtLink
          v-if="!session.isLoggedIn"
          to="/login"
          data-testid="header-login"
          class="flex h-10 items-center rounded-xl bg-(--color-accent-strong) px-4 text-sm font-semibold text-(--color-fill-text) transition-colors hover:bg-(--color-accent-deep) active:bg-(--color-accent-pressed)"
        >
          ورود
        </NuxtLink>
        <button
          v-else
          type="button"
          title="خروج از حساب"
          aria-label="خروج از حساب"
          data-testid="header-logout"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-all duration-200 hover:bg-(--color-danger-soft) hover:text-(--color-danger) active:scale-90"
          @click="logout"
        >
          <BaseIcon name="logout" :size="18" />
        </button>
      </div>
    </div>
  </header>
</template>
