<!-- apps/admin-panel/src/components/layout/SidebarNav.vue -->
<script setup lang="ts">
const LINKS = [
  { to: '/', label: 'داشبورد' },
  { to: '/salons', label: 'آرایشگاه‌ها' },
  { to: '/reviews', label: 'نظرات' },
  { to: '/categories', label: 'دسته‌بندی‌ها' },
  { to: '/users', label: 'کاربران' },
  { to: '/config', label: 'تنظیمات' },
]
</script>

<template>
  <nav class="flex h-screen w-56 shrink-0 flex-col gap-1 border-l bg-(--color-surface-card) p-4">
    <RouterLink
      v-for="link in LINKS"
      :key="link.to"
      :to="link.to"
      class="rounded-lg px-3 py-2 text-sm"
      active-class="bg-(--color-accent) font-bold text-white"
    >
      {{ link.label }}
    </RouterLink>
  </nav>
</template>
