<script setup lang="ts">
import { useId } from 'vue'
import AppIcon from './AppIcon.vue'
import type { IconName } from './AppIcon.vue'

withDefaults(
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

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })
const inputId = useId()
</script>

<template>
  <div class="min-w-0">
    <!-- min-w-0 above: an <input>'s intrinsic width comes from its `size` attribute (~11rem),
         so wherever this component is used directly as a flex or grid item its automatic
         minimum size would stop the field shrinking and overflow the row instead. A no-op
         wherever there is room, i.e. every layout this desktop-primary panel is built around.
         Note: this comment must stay INSIDE the root element -- a comment at the template
         root would make the component multi-root and break `$el` for callers that reach for
         the inner <input> (LoginView focuses the OTP field that way). -->
    <label v-if="label" :for="inputId" class="mb-1.5 block text-sm font-medium text-(--color-text)">
      {{ label }}
    </label>
    <div class="relative">
      <span
        v-if="icon"
        class="pointer-events-none absolute inset-y-0 start-3.5 flex items-center text-(--color-text-muted)"
      >
        <AppIcon :name="icon" :size="18" />
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
        v-bind="$attrs"
        class="w-full rounded-xl border bg-(--color-surface-card) py-3 text-(--color-text) transition-colors placeholder:text-(--color-text-muted)/60 focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30 disabled:cursor-not-allowed disabled:opacity-60"
        :class="[
          icon ? 'ps-11 pe-4' : 'px-4',
          align === 'center' ? 'text-center tracking-[0.4em]' : '',
          error ? 'border-(--color-danger) focus:border-(--color-danger) focus:ring-(--color-danger)/30' : 'border-(--color-border) focus:border-(--color-accent)',
        ]"
      />
    </div>
    <p v-if="error" class="mt-1.5 flex items-start gap-1 text-xs text-(--color-danger)">
      <AppIcon name="warning" :size="14" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>
  </div>
</template>
