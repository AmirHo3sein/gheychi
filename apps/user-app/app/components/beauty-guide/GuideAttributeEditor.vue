<!-- apps/user-app/app/components/beauty-guide/GuideAttributeEditor.vue
     The few attributes worth correcting (length, colour, texture / nail shape…). A pick here
     overwrites the AI's guess and is saved as the customer's own answer. -->
<script setup lang="ts">
import { ATTRIBUTE_LABELS, attributeKeysForDomain } from '../../utils/beauty-guide'

const props = defineProps<{ attributes: Record<string, string>; domain: string | null; busy?: boolean }>()
const emit = defineEmits<{ change: [key: string, value: string | null] }>()

const keys = computed(() => attributeKeysForDomain(props.domain))
</script>

<template>
  <section v-if="keys.length" class="space-y-3" aria-labelledby="guide-attributes-title">
    <h2 id="guide-attributes-title" class="font-bold text-(--color-text)">جزئیات (در صورت نیاز اصلاح کنید)</h2>
    <div v-for="key in keys" :key="key" class="space-y-1.5" :data-testid="`attribute-${key}`">
      <p class="text-xs text-(--color-text-muted)">{{ ATTRIBUTE_LABELS[key]!.label }}</p>
      <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="ATTRIBUTE_LABELS[key]!.label">
        <button
          v-for="(label, value) in ATTRIBUTE_LABELS[key]!.options"
          :key="value"
          type="button"
          role="radio"
          :aria-checked="attributes[key] === value"
          :disabled="busy"
          class="min-h-9 rounded-full border px-3 text-sm transition-colors"
          :class="
            attributes[key] === value
              ? 'border-(--color-accent) bg-(--color-accent-soft) font-semibold text-(--color-text)'
              : 'border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-subtle)'
          "
          :data-testid="`attribute-${key}-${value}`"
          @click="emit('change', key, attributes[key] === value ? null : String(value))"
        >
          {{ label }}
        </button>
      </div>
    </div>
  </section>
</template>
