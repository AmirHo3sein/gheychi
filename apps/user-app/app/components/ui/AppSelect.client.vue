<!-- apps/user-app/app/components/ui/AppSelect.client.vue -->
<!-- vue-multiselect wrapper, single-select, string value contract -- mirrors provider-panel
     and admin-panel's AppSelect.vue exactly (same .app-select CSS class, same vue-multiselect
     brand overrides in main.css), kept as this app's own copy per the cross-app isolation
     convention. `.client.vue` (Nuxt's client-only-component filename convention, matching
     SalonMap.client.vue/StoryViewer.client.vue) since vue-multiselect touches the DOM during
     its own setup, not just onMounted, and would break SSR otherwise. -->
<script setup lang="ts">
import Multiselect from 'vue-multiselect'
import 'vue-multiselect/dist/vue-multiselect.css'

export interface SelectOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    label?: string
    error?: string
    required?: boolean
    placeholder?: string
    disabled?: boolean
    searchable?: boolean
  }>(),
  // `searchable` defaults to true (vue-multiselect's own default, which this component has
  // always inherited) because the longest list here is the city list; short fixed lists pass
  // :searchable="false" so a two-option picker doesn't sprout a text field.
  { placeholder: 'انتخاب کنید', disabled: false, searchable: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// vue-multiselect's root is a role="combobox" div, not a labelable native control, so a
// native <label for> (BaseInput's pattern) can't reach it -- and its own `id` prop is
// consumed internally (only reaching the search input, and only in searchable mode), so it
// can't carry a `for` target either. aria-labelledby is the correct WAI-ARIA combobox
// association instead; it isn't a declared Multiselect prop, so Vue's default attrs
// fallthrough lands it on that root div for us. aria-required/aria-invalid ride along the
// same way, standing in for the `required` attribute and the error styling a native
// <select> would have carried natively.
const labelId = useId()

function onSelect(option: SelectOption | null) {
  emit('update:modelValue', option ? option.value : '')
}
</script>

<template>
  <div>
    <label v-if="label" :id="labelId" class="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
      {{ label }}
    </label>
    <Multiselect
      class="app-select"
      :class="{ 'app-select--error': error }"
      :model-value="props.options.find((o) => o.value === props.modelValue) ?? null"
      :options="props.options"
      label="label"
      track-by="value"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :searchable="props.searchable"
      :allow-empty="false"
      :show-labels="false"
      :aria-labelledby="props.label ? labelId : undefined"
      :aria-required="props.required ? 'true' : undefined"
      :aria-invalid="props.error ? 'true' : undefined"
      @update:model-value="onSelect"
    />
    <p v-if="error" class="mt-1.5 flex items-center gap-1 text-xs text-(--color-danger)">
      <BaseIcon name="alert-circle" :size="14" />
      {{ error }}
    </p>
  </div>
</template>
