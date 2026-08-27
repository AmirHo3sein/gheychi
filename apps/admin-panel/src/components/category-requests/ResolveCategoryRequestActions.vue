<!-- apps/admin-panel/src/components/category-requests/ResolveCategoryRequestActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'

const props = defineProps<{ requestId: string; requestedName: string }>()

const emit = defineEmits<{
  updated: [request: { id: string; status: string }]
  /** The PATCH failed (e.g. a 409 lost race) -- the parent should reload so the row
      reflects the winning admin's state instead of a stale, retry-doomed card. */
  refresh: []
}>()

// Same free-text icon key convention as CategoriesView.vue's own create form -- no
// upload/picker exists in this app, a known key renders a real glyph and anything else
// falls back to a generic tag icon.
const KNOWN_ICONS: IconName[] = ['scissors', 'palette', 'droplet', 'nail', 'sparkles', 'brush', 'eye', 'razor', 'tag']

function iconFor(icon: string): IconName {
  return (KNOWN_ICONS as string[]).includes(icon) ? (icon as IconName) : 'tag'
}

const { apiFetch } = useApi()
const mode = ref<'approve' | 'reject' | null>(null)
const approveName = ref('')
const approveIcon = ref('')
const rejectNote = ref('')
const submitting = ref(false)

function openApprove() {
  mode.value = 'approve'
  approveName.value = props.requestedName
  approveIcon.value = ''
}

function openReject() {
  mode.value = 'reject'
  rejectNote.value = ''
}

function collapse() {
  mode.value = null
}

async function submitApprove() {
  if (submitting.value || !approveName.value.trim() || !approveIcon.value.trim()) return
  submitting.value = true
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/category-requests/${props.requestId}/approve`, {
    method: 'PATCH',
    body: { name: approveName.value.trim(), icon: approveIcon.value.trim() },
  })
  submitting.value = false
  collapse()
  if (data) emit('updated', data)
  else emit('refresh')
}

async function submitReject() {
  if (submitting.value || !rejectNote.value.trim()) return
  submitting.value = true
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/category-requests/${props.requestId}/reject`, {
    method: 'PATCH',
    body: { note: rejectNote.value.trim() },
  })
  submitting.value = false
  collapse()
  if (data) emit('updated', data)
  else emit('refresh')
}
</script>

<template>
  <div>
    <div v-if="!mode" class="flex flex-wrap gap-2.5">
      <AppButton data-testid="open-approve" type="button" variant="secondary" :disabled="submitting" @click="openApprove">
        <template #icon><AppIcon name="check" :size="16" /></template>
        تایید و ایجاد دسته‌بندی
      </AppButton>
      <AppButton data-testid="open-reject" type="button" variant="danger" :disabled="submitting" @click="openReject">
        <template #icon><AppIcon name="x" :size="16" /></template>
        رد درخواست
      </AppButton>
    </div>

    <div v-else-if="mode === 'approve'" class="space-y-3">
      <p class="text-sm font-semibold text-(--color-text)">تایید و ایجاد دسته‌بندی</p>
      <div class="flex flex-wrap items-end gap-2.5">
        <div class="min-w-0 flex-1">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">نام دسته‌بندی</label>
          <AppInput v-model="approveName" data-testid="approve-name-input" :maxlength="60" />
        </div>
        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">کلید آیکون</label>
          <div class="flex items-center gap-2">
            <AppInput v-model="approveIcon" data-testid="approve-icon-input" placeholder="کلید آیکون" :maxlength="20" class="w-28" />
            <div
              data-testid="approve-icon-preview"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent-text)"
              title="پیش‌نمایش آیکون"
            >
              <AppIcon :name="iconFor(approveIcon)" :size="19" />
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-wrap gap-2.5">
        <AppButton
          data-testid="submit-approve"
          type="button"
          variant="primary"
          :loading="submitting"
          :disabled="submitting || !approveName.trim() || !approveIcon.trim()"
          @click="submitApprove"
        >
          ثبت نهایی
        </AppButton>
        <AppButton data-testid="cancel-approve" type="button" variant="secondary" :disabled="submitting" @click="collapse">
          انصراف
        </AppButton>
      </div>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">دلیل رد درخواست</label>
      <!-- maxlength mirrors RejectCategoryRequestDto's @Length(1, 500); required, unlike
           ResolveReportActions' optional note -- the salon deserves a real reason. -->
      <textarea
        v-model="rejectNote"
        data-testid="reject-note-input"
        placeholder="مثلاً: این دسته‌بندی با موارد موجود همپوشانی دارد…"
        rows="2"
        maxlength="500"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm [color-scheme:light_dark]"
      />
      <div class="flex flex-wrap gap-2.5">
        <AppButton
          data-testid="submit-reject"
          type="button"
          variant="danger"
          :loading="submitting"
          :disabled="submitting || !rejectNote.trim()"
          @click="submitReject"
        >
          ثبت نهایی
        </AppButton>
        <AppButton data-testid="cancel-reject" type="button" variant="secondary" :disabled="submitting" @click="collapse">
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
