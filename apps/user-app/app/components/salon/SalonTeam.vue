<!-- apps/user-app/app/components/salon/SalonTeam.vue -->
<script setup lang="ts">
interface WorkerItem {
  id: string
  name: string
  ratingAvg: string | number
  ratingCount: number
}

defineProps<{ workers: WorkerItem[] }>()
</script>

<template>
  <section v-if="workers.length" data-testid="salon-team">
    <h2 class="font-bold mb-2">تیم سالن</h2>
    <ul class="space-y-2">
      <li
        v-for="worker in workers"
        :key="worker.id"
        data-testid="salon-team-member"
        class="flex items-center justify-between gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm shadow-(--shadow-sm)"
      >
        <!-- A worker name comes from the salon owner and can be long; the rating is short
             and fixed-width, so the name is the side that gives (min-w-0 + break-words)
             and the rating is the side that stays whole (shrink-0 + nowrap). Without the
             gap the two used to be able to touch at 320px. -->
        <span class="min-w-0 break-words">{{ worker.name }}</span>
        <span v-if="worker.ratingCount" class="flex shrink-0 items-center gap-1 whitespace-nowrap text-(--color-text-muted)">
          <BaseIcon name="star" :size="14" />
          {{ Number(worker.ratingAvg).toFixed(1) }} ({{ worker.ratingCount }})
        </span>
        <span v-else class="shrink-0 text-(--color-text-muted)">بدون امتیاز</span>
      </li>
    </ul>
  </section>
</template>
