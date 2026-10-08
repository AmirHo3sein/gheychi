<script setup lang="ts">
import AppCard from '@/components/ui/AppCard.vue'

defineProps<{
  title: string
  emptyText: string
  rows: Array<{ key: string; name: string; count: number }>
  /** data-testid applied to each row. */
  rowTestId: string
}>()
</script>

<template>
  <AppCard>
    <h2 class="mb-2 text-sm font-bold text-(--color-text)">{{ title }}</h2>
    <p v-if="rows.length === 0" class="text-xs text-(--color-text-muted)">{{ emptyText }}</p>
    <ul v-else class="space-y-1.5">
      <li v-for="row in rows" :key="row.key" :data-testid="rowTestId" class="flex items-center justify-between gap-2 text-sm">
        <span class="min-w-0 break-words text-(--color-text)">{{ row.name }}</span>
        <span class="tnum shrink-0 text-(--color-text-muted)">{{ row.count.toLocaleString('fa-IR') }} نوبت</span>
      </li>
    </ul>
  </AppCard>
</template>
