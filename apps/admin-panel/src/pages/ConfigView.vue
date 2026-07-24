<!-- apps/admin-panel/src/pages/ConfigView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
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
const saving = ref(false)

async function load() {
  const { data } = await apiFetch<ConfigRow[]>('/admin/config', { silent: true })
  rows.value = data ?? []
}

async function save() {
  saving.value = true
  const { error } = await apiFetch('/admin/config', {
    method: 'PATCH',
    body: { updates: rows.value.map((r) => ({ key: r.key, value: r.value })) },
  })
  if (!error) pushToast('تغییرات ذخیره شد')
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-8">
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

    <AppButton variant="primary" :disabled="saving" @click="save">
      ذخیره تغییرات
    </AppButton>
  </div>
</template>
