<script setup lang="ts">
const TABS = [
  { to: '/', label: 'داشبورد' },
  { to: '/bookings', label: 'نوبت‌ها' },
  { to: '/services', label: 'خدمات' },
  { to: '/reviews', label: 'نظرات' },
  { to: '/earnings', label: 'درآمد' },
]
</script>

<template>
  <nav class="fixed inset-x-0 bottom-0 flex border-t bg-(--color-surface-card)">
    <RouterLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      class="flex-1 py-3 text-center text-sm"
      active-class="text-(--color-accent) font-bold"
    >
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>
