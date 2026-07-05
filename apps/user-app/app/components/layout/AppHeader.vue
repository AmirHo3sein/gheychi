<script setup lang="ts">
const session = useSessionStore()
</script>

<template>
  <header class="flex items-center justify-between px-4 py-3 bg-(--color-surface-card)">
    <NuxtLink to="/" class="font-bold text-lg">آرایشگاه</NuxtLink>
    <nav class="flex items-center gap-3 text-sm">
      <NuxtLink v-if="session.isLoggedIn" to="/bookings">نوبت‌های من</NuxtLink>
      <NuxtLink v-if="session.isLoggedIn" to="/profile">پروفایل</NuxtLink>
      <ThemeToggle />
    </nav>
  </header>
</template>
