<!-- apps/user-app/app/components/salon/SalonShareButton.vue
     «اشتراک‌گذاری» on a salon page: the phone's native share sheet when there is one, else the
     link is copied and a toast says so. The shared link carries ?source=direct so a booking
     that arrives through it is attributed (utils/attribution.ts). The QR code is its own
     button beside this one (SalonQrButton.vue). -->
<script setup lang="ts">
import { salonShareUrl, shareLink } from '../../utils/share'

const props = defineProps<{ slug: string; salonName: string }>()

const busy = ref(false)
const { push } = useToast()

async function share() {
  if (busy.value) return
  busy.value = true
  const url = salonShareUrl(window.location.origin, props.slug)
  const outcome = await shareLink({ title: props.salonName, text: `${props.salonName} در قیچی`, url }, navigator)
  busy.value = false
  if (outcome === 'copied') push('پیوند سالن کپی شد', 'success')
  else if (outcome === 'unavailable') push('کپی پیوند ممکن نشد؛ نشانی صفحه را از نوار مرورگر کپی کنید.', 'error')
}
</script>

<template>
  <button
    type="button"
    data-testid="salon-share-button"
    :disabled="busy"
    class="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-(--color-border) bg-(--color-surface-card) px-3.5 text-sm font-semibold text-(--color-text) transition-colors duration-150 hover:bg-(--color-surface-subtle) disabled:opacity-60"
    @click="share"
  >
    <BaseIcon name="share" :size="16" class="text-(--color-accent-text)" />
    <!-- Icon-only on the narrowest phones, where the salon name needs the width; the label
         stays in the accessibility tree either way. -->
    <span class="max-[359px]:sr-only">اشتراک‌گذاری</span>
  </button>
</template>
