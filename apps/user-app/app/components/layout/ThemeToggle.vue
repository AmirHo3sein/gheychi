<script setup lang="ts">
const { preference, setPreference } = useTheme()

const options: { value: 'light' | 'dark' | 'system'; label: string }[] = [
  { value: 'light', label: '☀️' },
  { value: 'dark', label: '🌙' },
  { value: 'system', label: '💻' },
]
</script>

<template>
  <div class="flex gap-1 rounded-full bg-(--color-surface-card) p-1">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      class="rounded-full px-2 py-1 text-sm"
      :class="{ 'bg-(--color-accent)': preference === opt.value }"
      @click="setPreference(opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
