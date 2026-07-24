<!-- apps/provider-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
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
const loading = ref(true)
const drafts = reactive<Record<string, string>>({})

onMounted(async () => {
  if (!salon.value) return
  const { data } = await apiFetch<Review[]>(`/salons/${salon.value.id}/reviews`, { silent: true })
  reviews.value = data ?? []
  for (const r of reviews.value) drafts[r.id] = r.salonReply ?? ''
  loading.value = false
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
  <div class="space-y-3 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">نظرات مشتریان</h1>

    <EmptyState v-if="!loading && reviews.length === 0" icon="reviews" message="هنوز نظری ثبت نشده است." />

    <AppCard v-for="r in reviews" :key="r.id" class="space-y-3">
      <div class="flex items-center gap-1 text-(--tone-warning-text)">
        <AppIcon v-for="i in 5" :key="i" name="star" :size="15" :fill="i <= r.rating ? 'currentColor' : 'none'" />
      </div>
      <p v-if="r.comment" class="text-sm text-(--color-text)">{{ r.comment }}</p>
      <p v-if="r.salonReply" class="rounded-xl bg-(--tone-info-bg) p-3 text-sm text-(--color-text)">
        <span class="font-semibold text-(--color-accent)">پاسخ شما: </span>{{ r.salonReply }}
      </p>
      <div class="flex gap-2">
        <AppInput
          v-model="drafts[r.id]"
          class="flex-1"
          :placeholder="r.salonReply ? 'ویرایش پاسخ' : 'پاسخ شما'"
        />
        <AppButton type="button" variant="secondary" @click="sendReply(r.id)">ارسال</AppButton>
      </div>
    </AppCard>
  </div>
</template>
