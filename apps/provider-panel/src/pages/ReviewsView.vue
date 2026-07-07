<!-- apps/provider-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'

interface Review {
  id: string
  rating: number
  comment: string | null
  salonReply: string | null
  createdAt: string
}

const { apiFetch } = useApi()
const { salon } = useSalon()
const reviews = ref<Review[]>([])
const drafts = reactive<Record<string, string>>({})

onMounted(async () => {
  if (!salon.value) return
  const { data } = await apiFetch<Review[]>(`/salons/${salon.value.id}/reviews`, { silent: true })
  reviews.value = data ?? []
  for (const r of reviews.value) drafts[r.id] = r.salonReply ?? ''
})

async function sendReply(id: string) {
  const reply = drafts[id]?.trim()
  if (!reply) return
  const { data } = await apiFetch<Review>(`/salons/mine/reviews/${id}/reply`, { method: 'PATCH', body: { reply } })
  if (data) {
    const target = reviews.value.find((r) => r.id === id)
    if (target) target.salonReply = data.salonReply
  }
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">نظرات مشتریان</h1>
    <div v-for="r in reviews" :key="r.id" class="space-y-2 rounded-lg border p-3">
      <p>{{ '⭐'.repeat(r.rating) }}</p>
      <p v-if="r.comment">{{ r.comment }}</p>
      <p v-if="r.salonReply" class="rounded bg-(--color-surface) p-2 text-sm">پاسخ شما: {{ r.salonReply }}</p>
      <div class="flex gap-2">
        <input v-model="drafts[r.id]" placeholder="پاسخ شما" class="flex-1 rounded-lg border p-2 text-sm" />
        <button type="button" class="rounded-lg border px-3 text-sm" @click="sendReply(r.id)">ارسال</button>
      </div>
    </div>
  </div>
</template>
