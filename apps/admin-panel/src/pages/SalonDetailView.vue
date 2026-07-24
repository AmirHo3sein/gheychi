<!-- apps/admin-panel/src/pages/SalonDetailView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import SalonStatusActions from '@/components/salons/SalonStatusActions.vue'
import ShowcaseStatusActions from '@/components/salons/ShowcaseStatusActions.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import { genderTargetLabel, salonStatusLabel, showcaseStatusLabel } from '@/utils/labels'

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

// Showcase moderation rows. The admin endpoints return ALL rows -- including removed
// ones and (for stories) expired ones -- because the public visibility gates don't
// apply here: an admin inspecting a report needs to see already-hidden evidence.
interface StoryRow {
  id: string
  url: string
  caption: string | null
  status: 'published' | 'removed'
  createdAt: string
  expiresAt: string
}

interface PortfolioRow {
  id: string
  url: string
  caption: string | null
  status: 'published' | 'removed'
  sortOrder: number
  createdAt: string
}

type Tab = 'info' | 'stories' | 'portfolio'

const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'مشخصات' },
  { key: 'stories', label: 'استوری‌ها' },
  { key: 'portfolio', label: 'نمونه کارها' },
]

const route = useRoute()
const { apiFetch } = useApi()
const salon = ref<SalonDetail | null>(null)
const notFound = ref(false)

const activeTab = ref<Tab>('info')
// null = tab never opened -- each list is fetched lazily on first activation and then
// kept fresh by reloading after every moderation action (success or lost race alike).
const stories = ref<StoryRow[] | null>(null)
const portfolioItems = ref<PortfolioRow[] | null>(null)

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

async function loadStories() {
  const { data } = await apiFetch<StoryRow[]>(`/admin/salons/${route.params.id}/stories`, { silent: true })
  stories.value = data ?? []
}

async function loadPortfolio() {
  const { data } = await apiFetch<PortfolioRow[]>(`/admin/salons/${route.params.id}/portfolio`, { silent: true })
  portfolioItems.value = data ?? []
}

function selectTab(tab: Tab) {
  activeTab.value = tab
  if (tab === 'stories' && stories.value === null) loadStories()
  if (tab === 'portfolio' && portfolioItems.value === null) loadPortfolio()
}

function onUpdated(updated: { id: string; status: string }) {
  if (salon.value) salon.value.status = updated.status as SalonDetail['status']
  load()
}

// Expiry is a fact derived from the DB-stamped timestamp, not a status value -- a story
// can be expired AND removed at once, so the badge renders alongside the status badge.
function isExpired(story: StoryRow): boolean {
  return new Date(story.expiresAt).getTime() <= Date.now()
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso))
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-8">
    <EmptyState v-if="notFound" icon="warning" message="آرایشگاه یافت نشد." />

    <template v-else-if="salon">
      <AppCard :padded="false" class="p-2">
        <div class="flex flex-wrap gap-1.5">
          <AppButton
            v-for="tab in TABS"
            :key="tab.key"
            :data-testid="`tab-${tab.key}`"
            type="button"
            :variant="activeTab === tab.key ? 'primary' : 'ghost'"
            @click="selectTab(tab.key)"
          >
            {{ tab.label }}
          </AppButton>
        </div>
      </AppCard>

      <template v-if="activeTab === 'info'">
        <AppCard>
          <div class="flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-(--color-border-soft) text-(--color-accent)">
                <AppIcon name="building" :size="22" />
              </div>
              <div>
                <h2 class="text-lg font-bold text-(--color-text)">{{ salon.name }}</h2>
                <p class="mt-0.5 text-sm text-(--color-text-muted)">{{ salon.city }} — {{ salon.address }}</p>
              </div>
            </div>
            <StatusBadge :label="salonStatusLabel(salon.status).label" :tone="salonStatusLabel(salon.status).tone" />
          </div>

          <p v-if="salon.description" class="mt-4 text-sm leading-6 text-(--color-text)">{{ salon.description }}</p>

          <div class="mt-5 grid grid-cols-2 gap-3 border-t border-(--color-border-soft) pt-4 text-sm">
            <div>
              <p class="text-xs text-(--color-text-muted)">مخاطب</p>
              <p class="mt-1 font-semibold">{{ genderTargetLabel(salon.genderTarget) }}</p>
            </div>
            <div>
              <p class="text-xs text-(--color-text-muted)">ظرفیت همزمان</p>
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

      <template v-else-if="activeTab === 'stories'">
        <EmptyState
          v-if="stories !== null && stories.length === 0"
          icon="sparkles"
          message="استوری‌ای برای این آرایشگاه ثبت نشده است."
        />
        <div v-else-if="stories !== null" class="space-y-3">
          <AppCard v-for="story in stories" :key="story.id" data-testid="story-card">
            <div class="flex items-start gap-4">
              <img :src="story.url" alt="" class="h-24 w-24 shrink-0 rounded-xl object-cover" />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <StatusBadge :label="showcaseStatusLabel(story.status).label" :tone="showcaseStatusLabel(story.status).tone" />
                  <StatusBadge v-if="isExpired(story)" data-testid="expired-badge" label="منقضی شده" tone="neutral" />
                </div>
                <p v-if="story.caption" class="mt-2 text-sm leading-6 text-(--color-text)">{{ story.caption }}</p>
                <p class="tnum mt-2 text-xs text-(--color-text-muted)">{{ formatDate(story.createdAt) }}</p>
              </div>
            </div>
            <div class="mt-4 border-t border-(--color-border-soft) pt-3.5">
              <ShowcaseStatusActions kind="stories" :item-id="story.id" :status="story.status" @updated="loadStories" @refresh="loadStories" />
            </div>
          </AppCard>
        </div>
      </template>

      <template v-else-if="activeTab === 'portfolio'">
        <EmptyState
          v-if="portfolioItems !== null && portfolioItems.length === 0"
          icon="brush"
          message="نمونه کاری برای این آرایشگاه ثبت نشده است."
        />
        <div v-else-if="portfolioItems !== null" class="space-y-3">
          <AppCard v-for="item in portfolioItems" :key="item.id" data-testid="portfolio-card">
            <div class="flex items-start gap-4">
              <img :src="item.url" alt="" class="h-24 w-24 shrink-0 rounded-xl object-cover" />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <StatusBadge :label="showcaseStatusLabel(item.status).label" :tone="showcaseStatusLabel(item.status).tone" />
                </div>
                <p v-if="item.caption" class="mt-2 text-sm leading-6 text-(--color-text)">{{ item.caption }}</p>
                <p class="tnum mt-2 text-xs text-(--color-text-muted)">{{ formatDate(item.createdAt) }}</p>
              </div>
            </div>
            <div class="mt-4 border-t border-(--color-border-soft) pt-3.5">
              <ShowcaseStatusActions kind="portfolio" :item-id="item.id" :status="item.status" @updated="loadPortfolio" @refresh="loadPortfolio" />
            </div>
          </AppCard>
        </div>
      </template>
    </template>
  </div>
</template>
