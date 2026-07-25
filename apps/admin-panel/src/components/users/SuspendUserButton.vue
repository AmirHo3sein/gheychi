<!-- apps/admin-panel/src/components/users/SuspendUserButton.vue -->
<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{
  userId: string
  status: 'active' | 'suspended'
  role: 'customer' | 'provider' | 'admin'
}>()
const emit = defineEmits<{ updated: [user: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const { push } = useToast()
const submitting = ref(false)
const confirming = ref(false)
const confirmButtonRef = ref<InstanceType<typeof AppButton> | null>(null)

// The v-if/v-else swap below unmounts the clicked toggle button the instant `confirming`
// flips, which drops keyboard focus to <body> with no visible indicator. Move focus onto
// the newly-mounted confirm control instead, once it exists in the DOM.
async function askConfirm() {
  confirming.value = true
  await nextTick()
  confirmButtonRef.value?.$el?.focus()
}

async function toggle() {
  submitting.value = true
  const target = props.status === 'active' ? 'suspended' : 'active'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/users/${props.userId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  confirming.value = false
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
  <div v-if="!confirming" class="flex flex-wrap gap-2.5">
    <AppButton
      v-if="status === 'active'"
      data-testid="suspend-user"
      type="button"
      variant="danger"
      :disabled="submitting"
      @click="askConfirm"
    >
      <template #icon><AppIcon name="lock" :size="14" /></template>
      تعلیق
    </AppButton>
    <AppButton
      v-else
      data-testid="unsuspend-user"
      type="button"
      variant="secondary"
      :disabled="submitting"
      @click="askConfirm"
    >
      <template #icon><AppIcon name="check" :size="14" /></template>
      رفع تعلیق
    </AppButton>
  </div>

  <div v-else class="flex flex-wrap items-center gap-2.5 text-sm">
    <span class="text-(--color-text)">
      <template v-if="status === 'active'">
        این کاربر معلق شود؟
        <span v-if="role === 'provider'" class="text-(--color-text-muted)">
          آرایشگاه تاییدشدهٔ او (در صورت وجود) نیز از دسترس عموم خارج خواهد شد.
        </span>
      </template>
      <template v-else>
        این کاربر رفع تعلیق شود؟
        <span v-if="role === 'provider'" class="text-(--color-text-muted)">
          آرایشگاهی که به دلیل تعلیق او معلق شده بود (در صورت وجود) بازگردانده خواهد شد.
        </span>
      </template>
    </span>
    <AppButton
      ref="confirmButtonRef"
      :data-testid="status === 'active' ? 'suspend-user-confirm' : 'unsuspend-user-confirm'"
      type="button"
      :variant="status === 'active' ? 'danger' : 'secondary'"
      :disabled="submitting"
      @click="toggle"
    >
      {{ status === 'active' ? 'تعلیق' : 'رفع تعلیق' }}
    </AppButton>
    <AppButton
      :data-testid="status === 'active' ? 'suspend-user-cancel' : 'unsuspend-user-cancel'"
      type="button"
      variant="secondary"
      :disabled="submitting"
      @click="confirming = false"
    >
      انصراف
    </AppButton>
  </div>
</template>
