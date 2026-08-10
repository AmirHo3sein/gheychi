<script setup lang="ts">
import type { IconName } from './BaseIcon.vue'

const props = withDefaults(
  defineProps<{
    label?: string
    icon?: IconName
    error?: string
    type?: string
    inputmode?: 'text' | 'tel' | 'numeric' | 'email'
    maxlength?: number
    placeholder?: string
    required?: boolean
    disabled?: boolean
    autofocus?: boolean
    align?: 'start' | 'center'
  }>(),
  { type: 'text', align: 'start' },
)

const model = defineModel<string>({ default: '' })
const inputId = useId()
</script>

<template>
  <div>
    <label v-if="label" :for="inputId" class="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
      {{ label }}
    </label>
    <div class="relative">
      <span
        v-if="icon"
        class="pointer-events-none absolute inset-y-0 start-3.5 flex items-center text-(--color-text-muted)"
      >
        <BaseIcon :name="icon" :size="18" />
      </span>
      <input
        :id="inputId"
        v-model="model"
        :type="type"
        :inputmode="inputmode"
        :maxlength="maxlength"
        :placeholder="placeholder"
        :required="required"
        :disabled="disabled"
        :autofocus="autofocus"
        class="h-11 w-full rounded-xl border bg-(--color-surface-card) text-(--color-text) transition-colors placeholder:text-(--color-text-muted) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30 disabled:cursor-not-allowed disabled:opacity-60"
        :class="[
          icon ? 'ps-11 pe-4' : 'px-4',
          align === 'center' ? 'text-center tracking-[0.4em]' : '',
          error ? 'border-(--color-danger) focus:border-(--color-danger)' : 'border-(--color-border) focus:border-(--color-accent)',
        ]"
      />
    </div>
    <p v-if="error" class="mt-1.5 flex items-center gap-1 text-xs text-(--color-danger)">
      <BaseIcon name="alert-circle" :size="14" />
      {{ error }}
    </p>
  </div>
</template>
