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
        class="flex items-center justify-between rounded-lg bg-(--color-surface-card) p-3 text-sm"
      >
        <span>{{ worker.name }}</span>
        <span v-if="worker.ratingCount" class="text-(--color-text-muted)">
          ⭐ {{ Number(worker.ratingAvg).toFixed(1) }} ({{ worker.ratingCount }})
        </span>
        <span v-else class="text-(--color-text-muted)">بدون امتیاز</span>
      </li>
    </ul>
  </section>
</template>
