<!-- apps/admin-panel/src/components/ui/StatusBadge.vue -->
<script setup lang="ts">
import type { Tone } from '@/utils/labels'

defineProps<{ label: string; tone: Tone }>()

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-(--tone-success-bg) text-(--tone-success-text)',
  warning: 'bg-(--tone-warning-bg) text-(--tone-warning-text)',
  danger: 'bg-(--tone-danger-bg) text-(--tone-danger-text)',
  neutral: 'bg-(--tone-neutral-bg) text-(--tone-neutral-text)',
  info: 'bg-(--tone-info-bg) text-(--tone-info-text)',
}

const DOT_CLASSES: Record<Tone, string> = {
  success: 'bg-(--tone-success-text)',
  warning: 'bg-(--tone-warning-text)',
  danger: 'bg-(--tone-danger-text)',
  neutral: 'bg-(--tone-neutral-text)',
  info: 'bg-(--tone-info-text)',
}
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
    :class="TONE_CLASSES[tone]"
  >
    <!-- shrink-0: the tone dot is the badge's only non-text cue, and as a flex item it would
         otherwise be the first thing squeezed to nothing in a cramped row. -->
    <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="DOT_CLASSES[tone]" />
    {{ label }}
  </span>
</template>
