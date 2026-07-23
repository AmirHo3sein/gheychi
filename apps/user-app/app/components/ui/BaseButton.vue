<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'lg'
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
    block?: boolean
  }>(),
  { variant: 'primary', size: 'md', loading: false, disabled: false, type: 'button', block: false },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    class="inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    :class="[
      block ? 'w-full' : '',
      size === 'lg' ? 'px-5 py-3.5 text-base' : 'px-4 py-2.5 text-sm',
      variant === 'primary' && 'bg-(--color-accent-strong) text-white shadow-(--shadow-sm) hover:bg-(--color-accent-deep) hover:shadow-(--shadow-md)',
      variant === 'secondary' && 'bg-(--color-surface-subtle) text-(--color-text) hover:bg-(--color-border)',
      variant === 'ghost' && 'bg-transparent text-(--color-text-muted) hover:bg-(--color-surface-subtle) hover:text-(--color-text)',
      variant === 'danger' && 'bg-(--color-danger-strong) text-white hover:opacity-90',
    ]"
  >
    <BaseIcon v-if="loading" name="spinner" :size="size === 'lg' ? 20 : 16" class="animate-spin" />
    <slot v-else name="icon" />
    <slot />
  </button>
</template>
