<!-- apps/admin-panel/src/components/ui/AppSelect.vue -->
<!-- Thin wrapper around vue-multiselect, giving every filter dropdown in the app a
     consistent, RTL-native, brand-styled look instead of the browser's native <select>.
     Brand overrides for vue-multiselect's own classes live in assets/css/main.css. -->
<script setup lang="ts">
import { computed } from 'vue'
import Multiselect from 'vue-multiselect'

export interface SelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    width?: string
    searchable?: boolean
  }>(),
  { placeholder: 'انتخاب کنید', disabled: false, width: '11rem', searchable: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

const selected = computed({
  get: () => props.options.find((o) => o.value === props.modelValue) ?? null,
  set: (option: SelectOption | null) => emit('update:modelValue', option?.value ?? ''),
})
</script>

<template>
  <!-- vue-multiselect's own CSS sets width:100% on its root as plain (unlayered) CSS, which
       always beats a Tailwind utility class here regardless of import order (Tailwind v4
       wraps utilities in @layer, and unlayered rules always win over layered ones in the
       cascade). An inline style sidesteps that entirely. -->
  <Multiselect
    v-model="selected"
    :options="options"
    track-by="value"
    label="label"
    :placeholder="placeholder"
    :searchable="searchable"
    :allow-empty="true"
    :close-on-select="true"
    :disabled="disabled"
    deselect-label=""
    select-label=""
    selected-label=""
    class="app-select"
    :style="{ width }"
  />
</template>
