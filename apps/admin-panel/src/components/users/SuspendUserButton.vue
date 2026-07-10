<!-- apps/admin-panel/src/components/users/SuspendUserButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  userId: string
  status: 'active' | 'suspended'
  role: 'customer' | 'provider' | 'admin'
}>()
const emit = defineEmits<{ updated: [user: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const { push } = useToast()
const submitting = ref(false)

async function toggle() {
  submitting.value = true
  const target = props.status === 'active' ? 'suspended' : 'active'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/users/${props.userId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  if (data) {
    // Providers get the cascade spelled out. Worded conditionally because the backend
    // cascade only touches an APPROVED salon on suspend (and only a cascade-suspended one
    // on reactivate) -- a pending/rejected salon is untouched, so the toast must not
    // assert an effect that may not have happened -- spec §3.5.
    if (props.role === 'provider') {
      push(
        target === 'suspended'
          ? 'کاربر معلق شد؛ آرایشگاه تاییدشدهٔ او (در صورت وجود) نیز از دسترس عموم خارج شد.'
          : 'کاربر فعال شد؛ آرایشگاهی که به دلیل تعلیق او معلق شده بود (در صورت وجود) بازگردانده شد.',
      )
    } else {
      push(target === 'suspended' ? 'کاربر معلق شد.' : 'کاربر فعال شد.')
    }
    emit('updated', data)
  }
}
</script>

<template>
  <button
    v-if="status === 'active'"
    data-testid="suspend-user"
    type="button"
    :disabled="submitting"
    class="inline-flex items-center gap-2 rounded-lg border border-(--tone-danger-text) px-3.5 py-2 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
    @click="toggle"
  >
    <AppIcon name="lock" :size="14" />
    تعلیق
  </button>
  <button
    v-else
    data-testid="unsuspend-user"
    type="button"
    :disabled="submitting"
    class="inline-flex items-center gap-2 rounded-lg bg-(--color-accent) px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
    @click="toggle"
  >
    <AppIcon name="check" :size="14" />
    رفع تعلیق
  </button>
</template>
