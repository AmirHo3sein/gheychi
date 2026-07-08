<!-- apps/admin-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ModerateReviewButton from '@/components/reviews/ModerateReviewButton.vue'

interface ReviewRow {
  id: string
  salonId: string
  rating: number
  comment: string | null
  status: 'published' | 'rejected'
  salonReply: string | null
}

const { apiFetch } = useApi()
const reviews = ref<ReviewRow[]>([])
const loading = ref(true)

const salonIdFilter = ref('')
const statusFilter = ref<'' | 'published' | 'rejected'>('')
const ratingFilter = ref<'' | number>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams()
  if (salonIdFilter.value) params.set('salonId', salonIdFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (ratingFilter.value) params.set('rating', String(ratingFilter.value))

  const { data } = await apiFetch<ReviewRow[]>(`/admin/reviews?${params.toString()}`, { silent: true })
  reviews.value = data ?? []
  loading.value = false
}

function onUpdated(reviewId: string, status: string) {
  const review = reviews.value.find((r) => r.id === reviewId)
  if (review) review.status = status as ReviewRow['status']
}

onMounted(load)
watch([salonIdFilter, statusFilter, ratingFilter], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">نظرات</h1>

    <div class="flex flex-wrap gap-3">
      <input v-model="salonIdFilter" placeholder="شناسه آرایشگاه" class="rounded-lg border p-2 text-sm" />
      <select v-model="statusFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه</option>
        <option value="published">منتشر شده</option>
        <option value="rejected">رد شده</option>
      </select>
      <select v-model="ratingFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه امتیازها</option>
        <option v-for="n in [1, 2, 3, 4, 5]" :key="n" :value="n">{{ n }} ستاره</option>
      </select>
    </div>

    <p v-if="!loading && reviews.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <div v-for="review in reviews" :key="review.id" class="space-y-1 rounded-lg border p-3">
      <p class="text-sm">امتیاز: {{ review.rating }} — وضعیت: {{ review.status }}</p>
      <p v-if="review.comment" class="text-sm">{{ review.comment }}</p>
      <p v-if="review.salonReply" class="text-sm text-gray-500">پاسخ آرایشگاه: {{ review.salonReply }}</p>
      <ModerateReviewButton
        :review-id="review.id"
        :status="review.status"
        @updated="(r) => onUpdated(r.id, r.status)"
      />
    </div>
  </div>
</template>
