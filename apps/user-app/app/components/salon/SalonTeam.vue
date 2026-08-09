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
    <h2 class="mb-2 flex items-center gap-1.5 text-lg font-bold text-(--color-text)">
      <BaseIcon name="user" :size="17" class="text-(--color-text-muted)" />
      تیم سالن
    </h2>
    <ul class="space-y-2">
      <li
        v-for="worker in workers"
        :key="worker.id"
        data-testid="salon-team-member"
        class="flex items-center gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm shadow-(--shadow-sm)"
      >
        <!-- No worker photo exists in this data at all -- a neutral icon-in-circle reads
             as "a person works here" without implying a specific, unverified likeness. -->
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--color-surface-subtle) text-(--color-text-muted)">
          <BaseIcon name="user" :size="18" />
        </span>
        <!-- A worker name comes from the salon owner and can be long; the rating is short
             and fixed-width, so the name is the side that gives (min-w-0 + break-words)
             and the rating is the side that stays whole (shrink-0 + nowrap). Without the
             gap the two used to be able to touch at 320px. -->
        <span class="min-w-0 flex-1 break-words">{{ worker.name }}</span>
        <span v-if="worker.ratingCount" class="flex shrink-0 items-center gap-1 whitespace-nowrap text-(--color-text-muted)">
          <BaseIcon name="star" :size="14" />
          {{ Number(worker.ratingAvg).toFixed(1) }} ({{ worker.ratingCount }})
        </span>
        <span v-else class="shrink-0 text-(--color-text-muted)">بدون امتیاز</span>
      </li>
    </ul>
  </section>
</template>
