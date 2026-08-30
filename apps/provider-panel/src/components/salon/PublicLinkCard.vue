<!-- apps/provider-panel/src/components/salon/PublicLinkCard.vue -->
<!-- Public salon link + QR (Phase 4 of the monetization initiative -- see
     docs/technical-overview/31-public-handle-and-attribution.md). Reuses salon.slug directly
     as the shareable URL (gheychi.co/salons/<handle> in production) rather than a separate
     /s/<handle> route -- the owner's own decision, see the monetization spec. The QR payload
     is just that same URL with a `?source=qr` tag (attribution.ts on the user-app side reads
     it) -- generated client-side (qrcode package) since it's public, non-sensitive data;
     no backend endpoint needed. -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'

// Public, non-secret -- baked into the static bundle at build time (see this app's own
// Dockerfile ARG/ENV and docs/deployment/DEPLOY.md), mirroring VITE_API_BASE's own pattern.
const CUSTOMER_APP_BASE = import.meta.env.VITE_CUSTOMER_APP_BASE ?? 'http://localhost:3003'
// Mirrors UpdateHandleDto's own @Matches regex (apps/api/src/salons/dto/salon-handle.dto.ts)
// -- client-side validation only saves a round trip; the server is still the sole authority
// (reserved-word and uniqueness checks can only happen there).
const HANDLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const { apiFetch } = useApi()
const { salon, refetch } = useSalon()
const { push: pushToast } = useToast()

const publicUrl = computed(() => (salon.value ? `${CUSTOMER_APP_BASE}/salons/${salon.value.slug}` : ''))
const qrUrl = computed(() => (publicUrl.value ? `${publicUrl.value}?source=qr` : ''))

const qrDataUrl = ref('')
watch(
  qrUrl,
  async (url) => {
    if (!url) {
      qrDataUrl.value = ''
      return
    }
    try {
      qrDataUrl.value = await QRCode.toDataURL(url, { margin: 1, width: 320 })
    } catch {
      // Non-critical: the plain link above still works without the image.
      qrDataUrl.value = ''
    }
  },
  { immediate: true },
)

const copied = ref(false)
async function copyLink() {
  try {
    await navigator.clipboard.writeText(publicUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Clipboard API can be unavailable (insecure context, permission denial) -- the URL is
    // already visible as plain selectable text, so this just means a manual copy instead of
    // a bug worth surfacing.
  }
}

function downloadQr() {
  if (!qrDataUrl.value) return
  const a = document.createElement('a')
  a.href = qrDataUrl.value
  a.download = `qr-${salon.value?.slug ?? 'salon'}.png`
  a.click()
}

const editing = ref(false)
const handleInput = ref('')
const handleError = ref('')
const saving = ref(false)

function startEdit() {
  handleInput.value = salon.value?.slug ?? ''
  handleError.value = ''
  editing.value = true
}

async function saveHandle() {
  const trimmed = handleInput.value.trim()
  if (trimmed.length < 3 || trimmed.length > 40 || !HANDLE_RE.test(trimmed)) {
    handleError.value = 'آدرس فقط می‌تواند شامل حروف انگلیسی کوچک، عدد و خط تیره باشد (۳ تا ۴۰ کاراکتر، بدون خط تیره در ابتدا/انتها)'
    return
  }
  handleError.value = ''
  saving.value = true
  // A reserved-word/duplicate rejection surfaces via useApi's own default toast (not
  // silenced here) -- this screen has nothing more specific to say than the server's own
  // message in either case.
  const { error } = await apiFetch('/salons/mine/handle', { method: 'PATCH', body: { handle: trimmed } })
  saving.value = false
  if (error) return
  await refetch()
  editing.value = false
  pushToast('آدرس عمومی سالن به‌روزرسانی شد')
}
</script>

<template>
  <div class="space-y-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-sm)">
    <div>
      <h2 class="font-bold text-(--color-text)">لینک عمومی و کد QR</h2>
      <p class="mt-1 text-sm text-(--color-text-muted)">
        مشتریان با این لینک یا با اسکن کد QR مستقیم به صفحه عمومی سالن شما می‌رسند.
      </p>
    </div>

    <div v-if="!editing" class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <code
          dir="ltr"
          data-testid="public-url"
          class="min-w-0 flex-1 break-all rounded-lg bg-(--color-surface) px-3 py-2.5 text-sm text-(--color-text)"
        >{{ publicUrl }}</code>
        <AppButton type="button" variant="secondary" data-testid="copy-link-button" @click="copyLink">
          {{ copied ? 'کپی شد' : 'کپی لینک' }}
        </AppButton>
        <AppButton type="button" variant="ghost" data-testid="edit-handle-button" @click="startEdit">
          <template #icon><AppIcon name="pencil" :size="15" /></template>
          ویرایش آدرس
        </AppButton>
      </div>

      <div v-if="qrDataUrl" class="flex flex-wrap items-center gap-4">
        <img
          :src="qrDataUrl"
          alt="کد QR صفحه عمومی سالن"
          data-testid="qr-image"
          class="h-32 w-32 shrink-0 rounded-lg border border-(--color-border)"
        />
        <AppButton type="button" variant="secondary" data-testid="download-qr-button" @click="downloadQr">
          دانلود کد QR
        </AppButton>
      </div>
    </div>

    <div v-else class="space-y-3">
      <AppInput
        v-model="handleInput"
        label="آدرس عمومی"
        dir="ltr"
        data-testid="handle-input"
        :error="handleError"
      />
      <div class="flex gap-2.5">
        <AppButton type="button" variant="primary" :disabled="saving" data-testid="save-handle-button" @click="saveHandle">
          ذخیره
        </AppButton>
        <AppButton type="button" variant="ghost" :disabled="saving" @click="editing = false">انصراف</AppButton>
      </div>
    </div>
  </div>
</template>
