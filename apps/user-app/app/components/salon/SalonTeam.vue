<!-- apps/user-app/app/components/salon/SalonTeam.vue -->
<script setup lang="ts">
import { workerDisplayLabels } from '../../utils/worker-label'

interface WorkerItem {
  id: string
  name: string
  ratingAvg: string | number
  ratingCount: number
}

const props = defineProps<{ workers: WorkerItem[] }>()

// Owner-typed placeholders («عضو ۱») become «متخصص سالن» -- see utils/worker-label.ts.
const labels = computed(() => workerDisplayLabels(props.workers))
</script>

<template>
  <section v-if="workers.length" data-testid="salon-team">
    <h2 class="mb-2 flex items-center gap-1.5 text-xl font-bold text-(--color-text)">
      <BaseIcon name="user" :size="17" class="text-(--color-text-muted)" />
      تیم سالن
    </h2>
    <ul class="grid gap-2 sm:grid-cols-2">
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
             and the rating is the side that stays whole (shrink-0 + nowrap). -->
        <span class="min-w-0 flex-1 break-words text-(--color-text)" data-testid="salon-team-member-name">{{ labels[worker.id] }}</span>
        <!-- Only a real rating is shown. «بدون امتیاز» next to a person read as a verdict on
             them rather than "nobody has rated yet", so a worker without ratings simply has
             no rating line. -->
        <span v-if="worker.ratingCount" class="flex shrink-0 items-center gap-1 whitespace-nowrap text-(--color-text-muted)">
          <BaseIcon name="star" :size="14" class="text-(--color-premium)" />
          {{ Number(worker.ratingAvg).toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} ({{ worker.ratingCount.toLocaleString('fa-IR') }})
        </span>
      </li>
    </ul>
  </section>
</template>
