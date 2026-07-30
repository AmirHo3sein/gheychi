<script setup lang="ts">
const session = useSessionStore()
</script>

<template>
  <header class="flex items-center justify-between border-b border-(--color-border) bg-(--color-surface-card) px-4 py-3">
    <NuxtLink to="/" class="flex items-center gap-2">
      <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-(--color-accent) text-white">
        <BaseIcon name="sparkles" :size="16" />
      </span>
      <span class="font-bold">قیچی</span>
    </NuxtLink>
    <nav class="flex items-center gap-1 text-sm" aria-label="ناوبری اصلی">
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
