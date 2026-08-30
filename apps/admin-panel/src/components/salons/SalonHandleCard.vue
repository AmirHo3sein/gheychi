<!-- apps/admin-panel/src/components/salons/SalonHandleCard.vue -->
<!-- Admin override of a salon's public handle (Phase 4 of the monetization initiative --
     docs/technical-overview/31-public-handle-and-attribution.md). The owner has the primary
     edit route (provider-panel's PublicLinkCard); this is recourse only, for when a salon
     picks something inappropriate -- no QR/copy-link affordance needed here, an admin isn't
     the one sharing it. No own fetch: the current slug arrives as a prop from
     SalonDetailView's already-loaded salon record. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'

const props = defineProps<{ salonId: string; slug: string }>()
const emit = defineEmits<{ updated: [slug: string] }>()

// Mirrors UpdateHandleDto's own @Matches regex (apps/api/src/salons/dto/salon-handle.dto.ts).
const HANDLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const { apiFetch } = useApi()
const { push: pushToast } = useToast()

const editing = ref(false)
const handleInput = ref('')
const handleError = ref('')
const saving = ref(false)

function startEdit() {
  handleInput.value = props.slug
  handleError.value = ''
  editing.value = true
}

async function save() {
  const trimmed = handleInput.value.trim()
  if (trimmed.length < 3 || trimmed.length > 40 || !HANDLE_RE.test(trimmed)) {
    handleError.value = 'آدرس فقط می‌تواند شامل حروف انگلیسی کوچک، عدد و خط تیره باشد (۳ تا ۴۰ کاراکتر)'
    return
  }
  handleError.value = ''
  saving.value = true
  const { data, error } = await apiFetch<{ slug: string }>(`/admin/salons/${props.salonId}/handle`, {
    method: 'PATCH',
    body: { handle: trimmed },
  })
  saving.value = false
  if (error || !data) return // server's own message (reserved/duplicate) surfaces via useApi's default toast
  editing.value = false
  emit('updated', data.slug)
  pushToast('آدرس عمومی سالن به‌روزرسانی شد')
}
</script>

<template>
  <div class="mt-5 border-t border-(--color-border-soft) pt-4">
    <p class="text-xs text-(--color-text-muted)">آدرس عمومی</p>

    <div v-if="!editing" class="mt-1 flex flex-wrap items-center gap-2">
      <code dir="ltr" data-testid="handle-value" class="break-all text-sm text-(--color-text)">/salons/{{ slug }}</code>
      <AppButton type="button" variant="ghost" data-testid="edit-handle-button" @click="startEdit">
        <template #icon><AppIcon name="pencil" :size="14" /></template>
        ویرایش
      </AppButton>
    </div>

    <div v-else class="mt-2 space-y-2">
      <AppInput v-model="handleInput" dir="ltr" data-testid="handle-input" :error="handleError" />
      <div class="flex gap-2.5">
        <AppButton type="button" variant="primary" :disabled="saving" data-testid="save-handle-button" @click="save">
          ذخیره
        </AppButton>
        <AppButton type="button" variant="ghost" :disabled="saving" @click="editing = false">انصراف</AppButton>
      </div>
    </div>
  </div>
</template>
