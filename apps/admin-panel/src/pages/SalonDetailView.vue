<!-- apps/admin-panel/src/pages/SalonDetailView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import SalonStatusActions from '@/components/salons/SalonStatusActions.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { genderTargetLabel, salonStatusLabel } from '@/utils/labels'

interface SalonDetail {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
  rejectionReason: string | null
  suspendedCause: 'admin' | 'owner_suspended' | null
}

const route = useRoute()
const { apiFetch } = useApi()
const salon = ref<SalonDetail | null>(null)
const notFound = ref(false)

async function load() {
  const { data, error } = await apiFetch<SalonDetail>(`/admin/salons/${route.params.id}`)
  if (data) {
    salon.value = data
    notFound.value = false
    return
  }
  // Only a confirmed 404 means the record genuinely doesn't exist. Any other
  // error (network failure, 5xx, etc.) -- notably the refetch triggered by
  // onUpdated() right after a successful approve/reject/suspend -- must not
  // wipe already-known-good salon state; the apiFetch call above already
  // surfaces a toast for it.
  if (error?.status === 404) notFound.value = true
}

function onUpdated(updated: { id: string; status: string }) {
  if (salon.value) salon.value.status = updated.status as SalonDetail['status']
  load()
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-8">
    <EmptyState v-if="notFound" icon="warning" message="آرایشگاه یافت نشد." />

    <template v-else-if="salon">
      <AppCard>
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-start gap-3">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent)">
              <AppIcon name="building" :size="22" />
            </div>
            <div>
              <h2 class="text-lg font-bold text-(--color-text)">{{ salon.name }}</h2>
              <p class="mt-0.5 text-sm text-(--color-muted)">{{ salon.city }} — {{ salon.address }}</p>
            </div>
          </div>
          <StatusBadge :label="salonStatusLabel(salon.status).label" :tone="salonStatusLabel(salon.status).tone" />
        </div>

        <p v-if="salon.description" class="mt-4 text-sm leading-6 text-(--color-text)">{{ salon.description }}</p>

        <div class="mt-5 grid grid-cols-2 gap-3 border-t border-(--color-border-soft) pt-4 text-sm">
          <div>
            <p class="text-xs text-(--color-muted)">مخاطب</p>
            <p class="mt-1 font-semibold">{{ genderTargetLabel(salon.genderTarget) }}</p>
          </div>
          <div>
            <p class="text-xs text-(--color-muted)">ظرفیت همزمان</p>
            <p class="tnum mt-1 font-semibold">{{ salon.capacity }} نفر</p>
          </div>
        </div>

        <div v-if="salon.rejectionReason" class="mt-5 flex gap-2.5 rounded-xl bg-(--tone-danger-bg) p-3.5">
          <AppIcon name="warning" :size="17" class="mt-0.5 shrink-0 text-(--tone-danger-text)" />
          <p class="text-sm text-(--tone-danger-text)">{{ salon.rejectionReason }}</p>
        </div>

        <div
          v-if="salon.status === 'suspended' && salon.suspendedCause === 'owner_suspended'"
          data-testid="suspended-cause"
          class="mt-5 flex gap-2.5 rounded-xl bg-(--tone-warning-bg) p-3.5"
        >
          <AppIcon name="warning" :size="17" class="mt-0.5 shrink-0 text-(--tone-warning-text)" />
          <p class="text-sm text-(--tone-warning-text)">
            این آرایشگاه به دلیل تعلیق حساب مالک آن معلق شده است و با رفع تعلیق مالک، به‌صورت خودکار به حالت تایید بازمی‌گردد.
          </p>
        </div>
      </AppCard>

      <AppCard>
        <SalonStatusActions :salon-id="salon.id" :status="salon.status" @updated="onUpdated" />
      </AppCard>
    </template>
  </div>
</template>
