<script setup lang="ts">
const session = useSessionStore()
</script>

<template>
  <!-- flex-wrap on both rows is load-bearing, not defensive styling. At 320px (the hard
       floor) a logged-in header needs ~355px for the logo, the two text links and the
       three-way theme toggle -- and the toggle is a fixed ~112px that cannot shrink or
       break at all -- against a 288px content box. Without wrapping the nav overflows the
       header, and in RTL that escapes to the LEFT, off the readable edge. Wrapping costs
       one extra header row on the narrowest phones and nothing from ~390px up, where it
       all fits on a single line again. -->
  <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-(--color-border) bg-(--color-surface-card) px-4 py-3">
    <NuxtLink to="/" class="flex items-center gap-2">
      <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-(--color-accent) text-white">
        <BaseIcon name="sparkles" :size="16" />
      </span>
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
    </nav>
  </header>
</template>
