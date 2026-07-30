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
// Only set when the salon has never successfully loaded and a non-404 error came back --
// distinct from a transient refetch failure after an action, which must not blank the page
// (see the comment in load() below).
const loadError = ref(false)
const loading = ref(false)

const activeTab = ref<Tab>('info')
// Per-tab status, not just null/array -- distinguishes "never opened" from "loading" from
// "loaded" from "failed", so a fetch failure isn't silently indistinguishable from a
// genuine empty list, and a switch-in gets a visible loading state.
type ListStatus = 'idle' | 'loading' | 'loaded' | 'error'
const storiesStatus = ref<ListStatus>('idle')
const stories = ref<StoryRow[]>([])
const portfolioStatus = ref<ListStatus>('idle')
const portfolioItems = ref<PortfolioRow[]>([])

async function load() {
  // Only show the full-page loading state on the very first load, not on the silent
  // refetch triggered after a successful moderation action.
  loading.value = salon.value === null
  const { data, error } = await apiFetch<SalonDetail>(`/admin/salons/${route.params.id}`)
  loading.value = false
  if (data) {
    salon.value = data
    notFound.value = false
    loadError.value = false
    return
  }
  // Only a confirmed 404 means the record genuinely doesn't exist. Any other
  // error (network failure, 5xx, etc.) -- notably the refetch triggered by
  // onUpdated() right after a successful approve/reject/suspend -- must not
  // wipe already-known-good salon state; the apiFetch call above already
  // surfaces a toast for it.
  if (error?.status === 404) {
    notFound.value = true
    return
  }
  // Only surface a persistent, retryable error state when there's nothing already on
  // screen -- a transient post-action refetch failure keeps showing the known-good salon.
  if (!salon.value) loadError.value = true
}

async function loadStories() {
  storiesStatus.value = 'loading'
  const { data } = await apiFetch<StoryRow[]>(`/admin/salons/${route.params.id}/stories`, { silent: true })
  if (data) {
    stories.value = data
    storiesStatus.value = 'loaded'
  } else {
    storiesStatus.value = 'error'
  }
}

async function loadPortfolio() {
  portfolioStatus.value = 'loading'
  const { data } = await apiFetch<PortfolioRow[]>(`/admin/salons/${route.params.id}/portfolio`, { silent: true })
  if (data) {
    portfolioItems.value = data
    portfolioStatus.value = 'loaded'
  } else {
    portfolioStatus.value = 'error'
  }
}

function selectTab(tab: Tab) {
  activeTab.value = tab
  if (tab === 'stories' && storiesStatus.value === 'idle') loadStories()
  if (tab === 'portfolio' && portfolioStatus.value === 'idle') loadPortfolio()
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
  <div class="mx-auto space-y-5 p-8" :class="activeTab === 'info' ? 'max-w-2xl' : 'max-w-6xl'">
    <div v-if="loading && !salon" data-testid="salon-loading" class="flex justify-center py-20">
      <AppIcon name="spinner" :size="28" class="animate-spin text-(--color-accent)" />
    </div>

    <EmptyState v-else-if="notFound" icon="warning" message="آرایشگاه یافت نشد." />

    <div
      v-else-if="loadError"
      data-testid="salon-load-error"
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--tone-danger-text)/50 py-16 text-center"
    >
      <AppIcon name="warning" :size="22" class="text-(--tone-danger-text)" />
      <p class="text-sm text-(--tone-danger-text)">بارگذاری اطلاعات آرایشگاه با خطا مواجه شد.</p>
      <AppButton data-testid="salon-load-retry" type="button" variant="secondary" @click="load">تلاش مجدد</AppButton>
    </div>

    <template v-else-if="salon">
      <AppCard :padded="false" class="p-2">
        <div role="tablist" class="flex flex-wrap gap-1.5">
          <AppButton
            v-for="tab in TABS"
            :key="tab.key"
            :data-testid="`tab-${tab.key}`"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.key"
            variant="ghost"
            :class="
              activeTab === tab.key
                ? 'bg-(--color-accent-soft)! text-(--color-accent-text)! hover:bg-(--color-accent-soft)! hover:text-(--color-accent-text)!'
                : ''
            "
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
          <!-- suspendedCause is passed through so the actions can refuse to offer a
               reapprove the backend would 409: an owner-suspension cascade is undone by
               reactivating the owner, not from here. -->
          <SalonStatusActions
            :salon-id="salon.id"
            :status="salon.status"
            :suspended-cause="salon.suspendedCause"
            @updated="onUpdated"
          />
        </AppCard>
      </template>

      <template v-else-if="activeTab === 'stories'">
        <div v-if="storiesStatus === 'loading'" data-testid="stories-loading" class="flex justify-center py-16">
          <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-accent)" />
        </div>

        <div
          v-else-if="storiesStatus === 'error'"
          data-testid="stories-error"
          class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--tone-danger-text)/50 py-16 text-center"
        >
          <AppIcon name="warning" :size="22" class="text-(--tone-danger-text)" />
          <p class="text-sm text-(--tone-danger-text)">بارگذاری استوری‌ها با خطا مواجه شد.</p>
          <AppButton data-testid="stories-retry" type="button" variant="secondary" @click="loadStories">تلاش مجدد</AppButton>
        </div>

        <EmptyState
          v-else-if="stories.length === 0"
          icon="sparkles"
          message="استوری‌ای برای این آرایشگاه ثبت نشده است."
        />

        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AppCard v-for="story in stories" :key="story.id" data-testid="story-card" :padded="false" class="overflow-hidden">
            <img
              :src="story.url"
              :alt="story.caption || 'تصویر استوری آرایشگاه در انتظار بررسی'"
              class="h-48 w-full shrink-0 object-cover"
            />
            <div class="p-4">
              <div class="flex flex-wrap items-center gap-2">
                <StatusBadge :label="showcaseStatusLabel(story.status).label" :tone="showcaseStatusLabel(story.status).tone" />
                <StatusBadge v-if="isExpired(story)" data-testid="expired-badge" label="منقضی شده" tone="neutral" />
              </div>
              <p v-if="story.caption" class="mt-2 text-sm leading-6 text-(--color-text)">{{ story.caption }}</p>
              <p class="tnum mt-2 text-xs text-(--color-text-muted)">{{ formatDate(story.createdAt) }}</p>
              <div class="mt-4 border-t border-(--color-border-soft) pt-3.5">
                <ShowcaseStatusActions kind="stories" :item-id="story.id" :status="story.status" @updated="loadStories" @refresh="loadStories" />
              </div>
            </div>
          </AppCard>
        </div>
      </template>

      <template v-else-if="activeTab === 'portfolio'">
        <div v-if="portfolioStatus === 'loading'" data-testid="portfolio-loading" class="flex justify-center py-16">
          <AppIcon name="spinner" :size="24" class="animate-spin text-(--color-accent)" />
        </div>

        <div
          v-else-if="portfolioStatus === 'error'"
          data-testid="portfolio-error"
          class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--tone-danger-text)/50 py-16 text-center"
        >
          <AppIcon name="warning" :size="22" class="text-(--tone-danger-text)" />
          <p class="text-sm text-(--tone-danger-text)">بارگذاری نمونه کارها با خطا مواجه شد.</p>
          <AppButton data-testid="portfolio-retry" type="button" variant="secondary" @click="loadPortfolio">تلاش مجدد</AppButton>
        </div>

        <EmptyState
          v-else-if="portfolioItems.length === 0"
          icon="brush"
          message="نمونه کاری برای این آرایشگاه ثبت نشده است."
        />

        <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AppCard v-for="item in portfolioItems" :key="item.id" data-testid="portfolio-card" :padded="false" class="overflow-hidden">
            <img
              :src="item.url"
              :alt="item.caption || 'تصویر نمونه کار آرایشگاه در انتظار بررسی'"
              class="h-48 w-full shrink-0 object-cover"
            />
            <div class="p-4">
              <div class="flex flex-wrap items-center gap-2">
                <StatusBadge :label="showcaseStatusLabel(item.status).label" :tone="showcaseStatusLabel(item.status).tone" />
              </div>
              <p v-if="item.caption" class="mt-2 text-sm leading-6 text-(--color-text)">{{ item.caption }}</p>
              <p class="tnum mt-2 text-xs text-(--color-text-muted)">{{ formatDate(item.createdAt) }}</p>
              <div class="mt-4 border-t border-(--color-border-soft) pt-3.5">
                <ShowcaseStatusActions kind="portfolio" :item-id="item.id" :status="item.status" @updated="loadPortfolio" @refresh="loadPortfolio" />
              </div>
            </div>
          </AppCard>
        </div>
      </template>
    </template>
  </div>
</template>
