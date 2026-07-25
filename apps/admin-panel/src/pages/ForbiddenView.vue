<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { useApi } from '@/composables/useApi'
import { useSessionStore } from '@/stores/session'

const router = useRouter()
const session = useSessionStore()
const { apiFetch } = useApi()

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST', silent: true })
  session.setUser(null)
  await router.push('/login')
}
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-(--color-surface) p-6 text-center">
    <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--tone-danger-bg) text-(--tone-danger-text)">
      <AppIcon name="lock" :size="28" />
    </div>
    <div>
      <h1 class="text-lg font-bold text-(--color-text)">دسترسی غیرمجاز</h1>
      <p class="mt-1 max-w-xs text-sm text-(--color-text-muted)">این بخش فقط برای مدیران سیستم قابل دسترسی است.</p>
    </div>
    <AppButton variant="secondary" @click="logout">
      <template #icon><AppIcon name="logout" :size="16" /></template>
      خروج و ورود با حساب دیگر
    </AppButton>
  </div>
</template>
