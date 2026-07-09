<script setup lang="ts">
import Multiselect from 'vue-multiselect'
import 'vue-multiselect/dist/vue-multiselect.css'

export interface SelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
  }>(),
  { placeholder: 'انتخاب کنید', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number | null] }>()

function onSelect(option: SelectOption | null) {
  emit('update:modelValue', option ? option.value : null)
}
</script>

<template>
  <Multiselect
    class="app-select"
    :model-value="props.options.find((o) => o.value === props.modelValue) ?? null"
    :options="props.options"
    label="label"
    track-by="value"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :allow-empty="false"
    :show-labels="false"
    @update:model-value="onSelect"
  />
</template>
