<!-- apps/admin-panel/src/pages/ConfigView.vue -->
<!-- Uniform Consequence Rule (DESIGN.md): PATCHing platform config is a money/behavior-moving
     action just like a wallet adjustment, so it gets the same confirm-before-commit shape as
     AdjustBalanceCard.vue -- a `confirming` toggle between the editable row list and a
     confirm-summary screen, scoped to only the rows that actually changed. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { configKeyMeta } from '@/utils/labels'

interface ConfigRow {
  key: string
  value: number
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const rows = ref<ConfigRow[]>([])
// Snapshot of what's currently persisted server-side -- diffed against `rows` to know which
// rows actually changed, both to gate the save button and to build the confirm summary.
const originalRows = ref<ConfigRow[]>([])
const saving = ref(false)
const confirming = ref(false)

async function load() {
  const { data } = await apiFetch<ConfigRow[]>('/admin/config', { silent: true })
  rows.value = (data ?? []).map((r) => ({ ...r }))
  originalRows.value = (data ?? []).map((r) => ({ ...r }))
}

function originalValueOf(key: string): number | undefined {
  return originalRows.value.find((r) => r.key === key)?.value
}

// Only the rows whose value actually differs from what's persisted -- the confirm summary
// must list precisely what will change, not the full config table.
const changedRows = computed(() => rows.value.filter((r) => originalValueOf(r.key) !== r.value))

const hasChanges = computed(() => changedRows.value.length > 0)

function askConfirm() {
  // Nothing changed -- no empty confirm screen, just no-op (the button is disabled for this
  // case too, but this guards direct calls/races).
  if (!hasChanges.value) return
  confirming.value = true
}

function cancelConfirm() {
  confirming.value = false
}

async function confirmSave() {
  saving.value = true
  const { error } = await apiFetch('/admin/config', {
    method: 'PATCH',
    body: { updates: rows.value.map((r) => ({ key: r.key, value: r.value })) },
  })
  saving.value = false
  if (!error) {
    pushToast('تغییرات ذخیره شد')
    originalRows.value = rows.value.map((r) => ({ ...r }))
    confirming.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-8">
    <template v-if="!confirming">
      <AppCard :padded="false">
        <div v-for="(row, i) in rows" :key="row.key" class="flex items-center justify-between gap-4 px-5 py-4" :class="i > 0 && 'border-t border-(--color-border-soft)'">
          <div>
            <p class="text-sm font-semibold text-(--color-text)">{{ configKeyMeta(row.key).label }}</p>
            <p v-if="configKeyMeta(row.key).hint" class="mt-0.5 text-xs text-(--color-text-muted)">{{ configKeyMeta(row.key).hint }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <AppInput
              :model-value="String(row.value)"
              type="number"
              class="tnum w-24 text-left"
              @update:model-value="(v) => (row.value = Number(v))"
            />
            <span v-if="configKeyMeta(row.key).unit" class="w-14 text-xs text-(--color-text-muted)">{{ configKeyMeta(row.key).unit }}</span>
          </div>
        </div>
      </AppCard>

      <AppButton variant="primary" data-testid="config-save-button" :disabled="saving || !hasChanges" @click="askConfirm">
        ذخیره تغییرات
      </AppButton>
    </template>

    <div v-else class="space-y-3.5">
      <p class="text-sm font-semibold text-(--tone-warning-text)">
        این تغییرات روی رفتار پلتفرم اثر می‌گذارد. لطفا موارد زیر را بررسی و تایید کنید:
      </p>
      <AppCard :padded="false" data-testid="config-confirm-summary">
        <div
          v-for="(row, i) in changedRows"
          :key="row.key"
          data-testid="config-confirm-row"
          class="flex items-center justify-between gap-4 px-5 py-4"
          :class="i > 0 && 'border-t border-(--color-border-soft)'"
        >
          <p class="text-sm font-semibold text-(--color-text)">{{ configKeyMeta(row.key).label }}</p>
          <p class="tnum text-sm text-(--color-text-muted)">
            از <span class="font-semibold text-(--color-text)">{{ originalValueOf(row.key) }}{{ configKeyMeta(row.key).unit }}</span>
            به <span class="font-semibold text-(--tone-warning-text)">{{ row.value }}{{ configKeyMeta(row.key).unit }}</span>
          </p>
        </div>
      </AppCard>
      <div class="flex gap-2.5">
        <AppButton type="button" data-testid="config-confirm-submit" :disabled="saving" :loading="saving" @click="confirmSave">
          تایید و ذخیره
        </AppButton>
        <AppButton type="button" variant="ghost" data-testid="config-confirm-cancel" :disabled="saving" @click="cancelConfirm">
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
