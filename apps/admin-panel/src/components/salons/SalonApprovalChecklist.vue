<!-- apps/admin-panel/src/components/salons/SalonApprovalChecklist.vue -->
<!-- The written listing bar (spec decision 6). Non-persistent on purpose: it exists to make
     the admin look before approving, and the audit log already records who approved. Native
     checkboxes inside a labelled group, so Tab/Space work with no custom key handling. -->
<script setup lang="ts">
import { APPROVAL_CHECKLIST } from '@/utils/salon-review'

const ticked = defineModel<Record<string, boolean>>({ required: true })

function toggle(key: string, value: boolean) {
  ticked.value = { ...ticked.value, [key]: value }
}
</script>

<template>
  <fieldset data-testid="approval-checklist" class="space-y-1">
    <legend class="text-sm font-bold text-(--color-text)">پیش از تایید، موارد زیر را بررسی کنید</legend>
    <label
      v-for="item in APPROVAL_CHECKLIST"
      :key="item.key"
      class="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-1 py-2 text-sm text-(--color-text) hover:bg-(--color-border-soft)"
    >
      <input
        type="checkbox"
        :data-testid="`check-${item.key}`"
        :checked="ticked[item.key] === true"
        class="mt-0.5 h-5 w-5 shrink-0 accent-(--color-accent-strong)"
        @change="toggle(item.key, ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ item.label }}</span>
    </label>
  </fieldset>
</template>
