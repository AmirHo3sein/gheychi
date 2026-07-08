<!-- apps/admin-panel/src/components/users/SuspendUserButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'

const props = defineProps<{ userId: string; status: 'active' | 'suspended' }>()
const emit = defineEmits<{ updated: [user: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const submitting = ref(false)

async function toggle() {
  submitting.value = true
  const target = props.status === 'active' ? 'suspended' : 'active'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/users/${props.userId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  if (data) emit('updated', data)
}
</script>

<template>
  <button
    v-if="status === 'active'"
    data-testid="suspend-user"
    type="button"
    :disabled="submitting"
    class="rounded-lg border border-red-600 px-3 py-1 text-sm text-red-600 disabled:opacity-40"
    @click="toggle"
  >
    تعلیق
  </button>
  <button
    v-else
    data-testid="unsuspend-user"
    type="button"
    :disabled="submitting"
    class="rounded-lg bg-(--color-accent) px-3 py-1 text-sm text-white disabled:opacity-40"
    @click="toggle"
  >
    رفع تعلیق
  </button>
</template>
