<script setup lang="ts">
import Multiselect from 'vue-multiselect'
import 'vue-multiselect/dist/vue-multiselect.css'
import type { SelectOption } from './AppSelect.vue'

// Sibling to AppSelect.vue, not a modification of it -- several single-select call
// sites depend on AppSelect's current single-value contract (allow-empty:false,
// emits one value). This is vue-multiselect's own `multiple` mode, unused anywhere
// else in this app until now.
const props = withDefaults(
  defineProps<{
    modelValue: Array<string | number>
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
  }>(),
  { placeholder: 'انتخاب کنید', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: Array<string | number>] }>()

function onSelect(selected: SelectOption[]) {
  emit('update:modelValue', selected.map((o) => o.value))
}
</script>

<template>
  <Multiselect
    class="app-select"
    :model-value="props.options.filter((o) => props.modelValue.includes(o.value))"
    :options="props.options"
    label="label"
    track-by="value"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    multiple
    :close-on-select="false"
    :show-labels="false"
    @update:model-value="onSelect"
  />
</template>
