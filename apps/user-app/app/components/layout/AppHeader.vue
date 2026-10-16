<script setup lang="ts">
const session = useSessionStore()
const { flags } = useFeatureFlags()

const NAV_LINK = 'rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors duration-150 hover:bg-(--color-surface-subtle) hover:text-(--color-text)'
const NAV_ACTIVE = '!bg-(--color-accent-soft) !text-(--color-text) font-semibold'
</script>

<template>
  <!-- One row at every width. The old header wrapped to two rows below ~370px (logo, then
       two text links, theme toggle and logout under it) and spent ~110px of a 640px-tall
       phone screen before any content. Phones now get the primary destinations from the
       bottom tab bar (BottomNav); this bar keeps only the brand, the theme toggle, and the
       one account action that matters when logged out (sign in). From `md` up the same
       destinations appear here as text links. Logout deliberately lives on the profile page
       only: a one-tap icon in the most-touched bar on every screen was too easy to hit.
       Solid surface, no backdrop blur: PRODUCT.md's budget-Android constraint rules out
       effects that assume a capable GPU, and a sticky header is repainted on every scroll. -->
  <header class="sticky top-0 z-30 print:hidden border-b border-(--color-border) bg-(--color-surface-card)">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 lg:px-6">
      <NuxtLink to="/" class="flex min-h-11 items-center gap-2" aria-label="قیچی — صفحه اصلی" data-testid="header-brand">
        <!-- Decorative: the wordmark beside it already names the brand to assistive tech. -->
        <img src="/brand-icon.png" alt="" width="36" height="36" class="h-9 w-9 shrink-0 rounded-xl" />
        <span class="text-lg leading-none font-extrabold tracking-tight">قیچی</span>
      </NuxtLink>

      <nav class="ms-4 hidden items-center gap-1 text-sm md:flex" aria-label="ناوبری اصلی">
        <NuxtLink
          to="/salons"
          :class="NAV_LINK"
          :active-class="NAV_ACTIVE"
        >
          سالن‌ها
        </NuxtLink>
        <NuxtLink
          v-if="session.isLoggedIn && flags.beautyGuideEnabled"
          to="/beauty-guide"
          :class="NAV_LINK"
          :active-class="NAV_ACTIVE"
        >
          راهنمای زیبایی
        </NuxtLink>
        <NuxtLink
          v-if="session.isLoggedIn"
          to="/bookings"
          :class="NAV_LINK"
          :active-class="NAV_ACTIVE"
        >
          نوبت‌های من
        </NuxtLink>
        <NuxtLink
          v-if="session.isLoggedIn"
          to="/profile"
          :class="NAV_LINK"
          :active-class="NAV_ACTIVE"
        >
          پروفایل
        </NuxtLink>
        <NuxtLink
          to="/blog"
          :class="NAV_LINK"
          :active-class="NAV_ACTIVE"
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
          class="flex h-10 items-center rounded-xl bg-(--color-accent) px-4 text-sm font-semibold text-(--color-fill-text) transition-colors hover:bg-(--color-accent-deep) active:bg-(--color-accent-pressed)"
        >
          ورود
        </NuxtLink>
      </div>
    </div>
  </header>
</template>
