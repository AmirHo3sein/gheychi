<!-- apps/user-app/app/components/salon/SalonQrButton.vue
     «کد QR» on a salon page: a scannable code for the page, to show a friend's phone camera or
     save as an image. Rendered only when the salon's plan includes the QR capability (the
     profile's qrCodeEnabled -- the same entitlement the provider panel's own QR follows).
     The qrcode library is imported only when the dialog opens, so the salon page itself
     carries none of it. -->
<script setup lang="ts">
import { lockBodyScroll } from '../../utils/scroll-lock'
import { salonQrUrl } from '../../utils/share'

const props = defineProps<{ slug: string; salonName: string }>()

const open = ref(false)
const dataUrl = ref('')
const failed = ref(false)
const dialogRoot = ref<HTMLElement | null>(null)

async function render() {
  failed.value = false
  dataUrl.value = ''
  try {
    const { toDataURL } = await import('qrcode')
    // Dark-on-white regardless of theme: scanners need the contrast, and a saved image is
    // printed or shown on other screens.
    dataUrl.value = await toDataURL(salonQrUrl(window.location.origin, props.slug), {
      margin: 2,
      width: 480,
      errorCorrectionLevel: 'M',
      color: { dark: '#2D2D2D', light: '#FFFFFF' },
    })
  } catch {
    failed.value = true
  }
}

function show() {
  open.value = true
  void render()
}
function close() {
  open.value = false
}

const { titleId } = useDialog(dialogRoot as unknown as Ref<HTMLElement | null>, { onClose: close, enabled: () => open.value })
const descriptionId = useId()

let unlock: (() => void) | null = null
watch(open, (isOpen) => {
  if (isOpen) unlock = lockBodyScroll()
  else {
    unlock?.()
    unlock = null
  }
})
onBeforeUnmount(() => unlock?.())

const fileName = computed(() => `qr-${props.slug}.png`)
</script>

<template>
  <button
    type="button"
    data-testid="salon-qr-button"
    aria-label="کد QR این سالن"
    title="کد QR"
    class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-(--color-border) bg-(--color-surface-card) text-(--color-accent-text) transition-colors duration-150 hover:bg-(--color-surface-subtle)"
    @click="show"
  >
    <BaseIcon name="qr" :size="18" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/40 sm:items-center sm:p-4"
      @click.self="close"
    >
      <div
        ref="dialogRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descriptionId"
        tabindex="-1"
        data-testid="salon-qr-dialog"
        class="w-full space-y-4 rounded-t-2xl border border-(--color-border) bg-(--color-surface-card) p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center shadow-(--shadow-lg) outline-none sm:max-w-sm sm:rounded-2xl sm:pb-6"
      >
        <div>
          <h2 :id="titleId" class="text-lg font-bold text-(--color-text)">کد QR سالن</h2>
          <p class="mt-0.5 text-sm break-words text-(--color-text-muted)">{{ salonName }}</p>
        </div>

        <div class="mx-auto flex aspect-square w-full max-w-60 items-center justify-center rounded-2xl border border-(--color-border-soft) bg-white p-2">
          <img v-if="dataUrl" :src="dataUrl" :alt="`کد QR صفحهٔ ${salonName} در قیچی`" width="240" height="240" class="h-full w-full" data-testid="salon-qr-image" />
          <p v-else-if="failed" role="alert" class="px-3 text-sm text-(--color-danger)">ساخت کد QR انجام نشد.</p>
          <span v-else class="h-full w-full animate-pulse rounded-xl bg-(--color-surface-subtle)" aria-hidden="true" />
        </div>

        <p :id="descriptionId" class="text-sm leading-6 text-(--color-text-muted)">با دوربین گوشی اسکن کنید تا صفحهٔ این سالن باز شود.</p>

        <div class="flex gap-2">
          <BaseButton variant="secondary" block data-testid="salon-qr-close" @click="close">بستن</BaseButton>
          <BaseButton v-if="failed" block @click="render">تلاش دوباره</BaseButton>
          <a
            v-else
            :href="dataUrl || undefined"
            :download="fileName"
            :aria-disabled="!dataUrl || undefined"
            data-testid="salon-qr-download"
            class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 text-sm font-semibold text-(--color-fill-text) shadow-(--shadow-sm) transition-colors duration-150 hover:bg-(--color-accent-deep) active:bg-(--color-accent-pressed)"
            :class="dataUrl ? '' : 'pointer-events-none opacity-60'"
          >
            <BaseIcon name="download" :size="16" />
            ذخیرهٔ تصویر
          </a>
        </div>
      </div>
    </div>
  </Teleport>
</template>
