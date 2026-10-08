<!-- apps/admin-panel/src/components/ui/AppSelect.vue -->
<!-- Thin wrapper around vue-multiselect, giving every filter dropdown in the app a
     consistent, RTL-native, brand-styled look instead of the browser's native <select>.
     Brand overrides for vue-multiselect's own classes live in assets/css/main.css. -->
<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import Multiselect from 'vue-multiselect'
import 'vue-multiselect/dist/vue-multiselect.css'

export interface SelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: SelectOption[]
    label?: string
    /** Accessible name when there is no visible `label` (the caller labels it some other way). */
    ariaLabel?: string
    placeholder?: string
    disabled?: boolean
    width?: string
    searchable?: boolean
  }>(),
  { placeholder: 'انتخاب کنید', disabled: false, width: '11rem', searchable: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

// vue-multiselect's root is a role="combobox" div, not a labelable native control, so a
// native <label for> (AppInput's pattern) can't reach it -- and its own `id` prop is
// consumed internally (only reaching the search input, and only in searchable mode), so it
// can't carry a `for` target either. aria-labelledby is the correct WAI-ARIA combobox
// association instead; it isn't a declared Multiselect prop, so Vue's default attrs
// fallthrough lands it on that root div for us.
const uid = useId()
const labelId = `${uid}-label`
// Passed to vue-multiselect so its `aria-controls="listbox-<id>"` points at a real listbox
// (without an id it renders the literal string "listbox-null").
const selectId = `${uid}-select`

// vue-multiselect hardcodes aria-controls="listbox-<id>" on its search input but only renders
// that listbox while open, leaving a dangling IDREF (an axe `aria-valid-attr-value` failure)
// whenever it's closed. A hidden stand-in with the same id covers the closed state.
const isOpen = ref(false)

const selected = computed({
  get: () => props.options.find((o) => o.value === props.modelValue) ?? null,
  set: (option: SelectOption | null) => emit('update:modelValue', option?.value ?? ''),
})
</script>

<template>
  <div>
    <label v-if="label" :id="labelId" :for="selectId" class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">
      {{ label }}
    </label>
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
      :id="selectId"
      :aria-labelledby="label ? labelId : undefined"
      :aria-label="label ? undefined : ariaLabel"
      deselect-label=""
      select-label=""
      selected-label=""
      class="app-select"
      :style="{ width }"
      @open="isOpen = true"
      @close="isOpen = false"
    />
    <ul v-if="searchable && !isOpen" :id="`listbox-${selectId}`" hidden />
  </div>
</template>
