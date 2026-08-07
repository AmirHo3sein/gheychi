<script setup lang="ts">
const session = useSessionStore()
const { logout } = useLogout()
</script>

<template>
  <!-- flex-wrap on both rows is load-bearing, not defensive styling. At 320px (the hard
       floor) a logged-in header needs ~330px for the logo, the two text links, the theme
       toggle, and the logout icon -- none of which can shrink or break -- against a 288px
       content box. Without wrapping the nav overflows the header, and in RTL that escapes to
       the LEFT, off the readable edge. Wrapping costs one extra header row on the narrowest
       phones and nothing from ~370px up, where it all fits on a single line again. -->
  <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-(--color-border) bg-(--color-surface-card) px-4 py-3">
    <NuxtLink to="/" class="flex items-center gap-2">
      <!-- Decorative: the wordmark beside it already names the brand to assistive tech. -->
      <img src="/brand-icon.png" alt="" class="h-8 w-8 shrink-0 rounded-xl" />
      <span class="font-bold">قیچی</span>
    </NuxtLink>
    <nav class="flex flex-wrap items-center justify-end gap-1 text-sm" aria-label="ناوبری اصلی">
      <NuxtLink
        v-if="session.isLoggedIn"
        to="/bookings"
        class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
      >
        نوبت‌های من
      </NuxtLink>
      <NuxtLink
        v-if="session.isLoggedIn"
        to="/profile"
        class="rounded-xl px-3 py-2 text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
      >
        پروفایل
      </NuxtLink>
      <ThemeToggle class="ms-1" />
      <button
        v-if="session.isLoggedIn"
        type="button"
        title="خروج از حساب"
        data-testid="header-logout"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-all duration-200 hover:bg-(--color-danger-soft) hover:text-(--color-danger) active:scale-90"
        @click="logout"
      >
        <BaseIcon name="logout" :size="18" />
      </button>
    </nav>
  </header>
</template>
