<script setup lang="ts">
import AppCard from '@/components/ui/AppCard.vue'

defineProps<{
  label: string
  value: string
  hint?: string
  deltaText: string
  /** Tailwind text-colour class for the delta line (good / bad / neutral). */
  deltaClass: string
}>()
</script>

<template>
  <AppCard class="bg-(--color-surface-subtle)">
    <p class="text-xs text-(--color-text-muted)">{{ label }}</p>
    <p class="mt-1 break-words text-lg font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ value }}</span></p>
    <p v-if="hint" class="mt-0.5 text-xs text-(--color-text-muted)">{{ hint }}</p>
    <p class="mt-1 text-xs" :class="deltaClass">{{ deltaText }}</p>
  </AppCard>
</template>
