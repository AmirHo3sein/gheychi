<script setup lang="ts">
const { preference, setPreference, apply } = useTheme()

const options: { value: 'light' | 'dark' | 'system'; label: string }[] = [
  { value: 'light', label: '☀️' },
  { value: 'dark', label: '🌙' },
  { value: 'system', label: '💻' },
]

// Re-sync the .dark class against the current cookie on mount: the inline anti-flash
// script only runs once at initial page load, so if the theme cookie changed since then
// (e.g. set in another tab) this catches the drift without requiring a reload.
onMounted(() => apply())
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
