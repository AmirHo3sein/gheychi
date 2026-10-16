<!-- apps/admin-panel/src/components/salons/RemoveServiceImageAction.vue -->
<!-- Admin takedown of one service's photo (DELETE /admin/services/:id/image, audited as
     salon.service.image.removed). Same trigger -> inline confirm strip shape as
     ModerateWorkerRatingButton.vue. Unlike a story/portfolio moderation this is NOT
     reversible -- the stored file is deleted -- so the confirm copy says so plainly. -->
<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ serviceId: string; serviceName: string }>()
const emit = defineEmits<{ removed: [serviceId: string] }>()

const { apiFetch } = useApi()
const submitting = ref(false)
const confirming = ref(false)
const confirmButtonRef = ref<InstanceType<typeof AppButton> | null>(null)
const triggerRef = ref<InstanceType<typeof AppButton> | null>(null)
const stripRef = ref<HTMLElement | null>(null)

// The v-if/v-else swap unmounts the clicked button, which would drop keyboard focus to
// <body>; move it onto whichever control replaced it.
async function askConfirm() {
  confirming.value = true
  await nextTick()
  // On narrow screens the services table scrolls sideways; bring the whole warning into
  // view, not just the button focus() would scroll to.
  stripRef.value?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  confirmButtonRef.value?.$el?.focus({ preventScroll: true })
}

async function cancel() {
  confirming.value = false
  await nextTick()
  triggerRef.value?.$el?.focus()
}

async function remove() {
  if (submitting.value) return
  submitting.value = true
  // Silent so a 409 is not shown as a red failure; every other error is toasted below
  // exactly as useApi would have (401 already redirects to /login, so it gets no toast).
  const { error } = await apiFetch<{ id: string; imageUrl: null }>(`/admin/services/${props.serviceId}/image`, {
    method: 'DELETE',
    silent: true,
  })
  submitting.value = false
  confirming.value = false
  // Success (and the 409 below) unmounts this whole control because the row no longer has
  // an image; any other failure keeps the image, so focus returns to the trigger.
  if (!error) {
    useToast().push(`تصویر خدمت «${props.serviceName}» حذف شد.`, 'success')
    emit('removed', props.serviceId)
  } else if (error.status === 409) {
    // 409 = the row already has no image (the owner removed/replaced it, or another admin
    // won the race): the outcome the operator wanted already holds, so it is reported as
    // information, not failure, and the stale thumbnail is dropped via the parent's refetch.
    useToast().push('تصویر این خدمت پیش‌تر حذف شده است', 'info')
    emit('removed', props.serviceId)
  } else {
    if (error.status !== 401) useToast().push(error.message, 'error')
    await nextTick()
    triggerRef.value?.$el?.focus()
  }
}
</script>

<template>
  <AppButton
    v-if="!confirming"
    ref="triggerRef"
    data-testid="remove-service-image"
    type="button"
    variant="ghost"
    :disabled="submitting"
    :aria-label="`حذف تصویر خدمت ${serviceName}`"
    @click="askConfirm"
  >
    <template #icon><AppIcon name="x" :size="15" /></template>
    حذف تصویر
  </AppButton>
  <div
    v-else
    ref="stripRef"
    data-testid="remove-service-image-strip"
    role="group"
    :aria-label="`تایید حذف تصویر خدمت ${serviceName}`"
    class="flex w-48 flex-wrap items-center gap-2 text-sm"
  >
    <!-- Fixed narrow width: this sits in the last column of a horizontally scrolling
         table, and a wider strip pushed the warning past the visible edge (it was only
         readable after scrolling). Wrapping the sentence keeps it inside the column. -->
    <p class="w-full whitespace-normal text-xs leading-5 text-(--color-text)">تصویر این خدمت برای همیشه حذف می‌شود و سالن باید تصویر جدیدی بارگذاری کند.</p>
    <AppButton
      ref="confirmButtonRef"
      data-testid="remove-service-image-confirm"
      type="button"
      variant="danger"
      :loading="submitting"
      :aria-label="`تایید حذف تصویر خدمت ${serviceName}`"
      @click="remove"
    >
      حذف تصویر
    </AppButton>
    <AppButton data-testid="remove-service-image-cancel" type="button" variant="secondary" :disabled="submitting" @click="cancel">
      انصراف
    </AppButton>
  </div>
</template>
