<script setup lang="ts">
withDefaults(defineProps<{ label?: string; required?: boolean; error?: string }>(), {})
const model = defineModel<string>({ default: '' })
const selectId = useId()
</script>

<template>
  <div>
    <label v-if="label" :for="selectId" class="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
      {{ label }}
    </label>
    <select
      :id="selectId"
      v-model="model"
      :required="required"
      class="w-full appearance-none rounded-xl border bg-(--color-surface-card) bg-no-repeat px-4 py-3 text-(--color-text) transition-colors focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30"
      :class="error ? 'border-(--color-danger)' : 'border-(--color-border) focus:border-(--color-accent)'"
      style="background-image: url('data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2218%22 height=%2218%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235B8783%22 stroke-width=%222%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E'); background-position: left 0.9rem center;"
    >
      <slot />
    </select>
    <p v-if="error" class="mt-1.5 flex items-center gap-1 text-xs text-(--color-danger)">
      <BaseIcon name="alert-circle" :size="14" />
      {{ error }}
    </p>
  </div>
</template>
