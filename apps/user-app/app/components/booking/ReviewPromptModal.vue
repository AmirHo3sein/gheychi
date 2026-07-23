<script setup lang="ts">
interface ReviewResponse {
  id: string
  rating: number
  comment: string | null
}

const props = defineProps<{ bookingId: string; workerName?: string | null }>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const { apiFetch } = useApi()

// 'form' -- initial create form
// 'view' -- already submitted (this session), read display with edit/delete actions
// 'edit' -- pre-filled edit form
// 'deleted' -- confirmation after a successful delete
// 'already-reviewed' -- 409 on create: a review exists from a previous session. There is
// no GET-by-booking endpoint to fetch that review's id/rating/comment, so it can't be
// pre-filled for editing here -- see the report for this known limitation.
const phase = ref<'form' | 'view' | 'edit' | 'deleted' | 'already-reviewed'>('form')

const hasWorker = computed(() => !!props.workerName)

const reviewId = ref<string | null>(null)
const rating = ref(5)
const workerRating = ref(5)
const comment = ref('')

const editRating = ref(5)
const editWorkerRating = ref(5)
const editComment = ref('')

const submitting = ref(false)
const savingEdit = ref(false)
const deleting = ref(false)

async function submit() {
  submitting.value = true
  const body: Record<string, unknown> = {
    bookingId: props.bookingId,
    rating: rating.value,
    comment: comment.value || undefined,
  }
  // Omitted entirely when the booking has no worker -- the API rejects a workerRating
  // present without a worker on the booking.
  if (hasWorker.value) body.workerRating = workerRating.value

  const { data, error } = await apiFetch<ReviewResponse>('/reviews', { method: 'POST', body })
  submitting.value = false
  if (error?.status === 409) {
    phase.value = 'already-reviewed'
    return
  }
  if (!error && data) {
    reviewId.value = data.id
    phase.value = 'view'
    emit('submitted')
  }
}

function startEdit() {
  editRating.value = rating.value
  editWorkerRating.value = workerRating.value
  editComment.value = comment.value
  phase.value = 'edit'
}

async function saveEdit() {
  if (!reviewId.value) return
  savingEdit.value = true
  const body: Record<string, unknown> = {
    rating: editRating.value,
    // Sent as a possibly-empty string (not `|| undefined`) so clearing the comment on
    // edit actually clears it server-side -- UpdateReviewDto only patches fields that
    // are explicitly present, unlike create's "omitted means null".
    comment: editComment.value,
  }
  if (hasWorker.value) body.workerRating = editWorkerRating.value

  const { error } = await apiFetch(`/reviews/${reviewId.value}`, { method: 'PATCH', body })
  savingEdit.value = false
  if (!error) {
    rating.value = editRating.value
    workerRating.value = editWorkerRating.value
    comment.value = editComment.value
    phase.value = 'view'
  }
  // On error (e.g. 403 past the edit window) apiFetch already surfaced a toast --
  // stay on the edit form so the user can see their unsaved input.
}

async function deleteReview() {
  if (!reviewId.value) return
  // Matches the native-confirm pattern already used for cancelBooking in bookings/index.vue.
  if (!confirm('این نظر حذف شود؟')) return

  deleting.value = true
  const { error } = await apiFetch(`/reviews/${reviewId.value}`, { method: 'DELETE' })
  deleting.value = false
  if (!error) phase.value = 'deleted'
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
    <BaseCard class="w-full max-w-sm space-y-3">
      <template v-if="phase === 'already-reviewed'">
        <p class="text-sm">شما قبلا برای این نوبت نظر ثبت کرده‌اید</p>
      </template>

      <template v-else-if="phase === 'deleted'">
        <p class="text-sm">نظر شما حذف شد</p>
      </template>

      <template v-else-if="phase === 'view'">
        <h2 class="font-bold">نظر شما ثبت شد</h2>
        <div class="flex gap-1 text-2xl" data-testid="view-salon-rating-stars" aria-hidden="true">
          <span v-for="n in 5" :key="n">{{ n <= rating ? '⭐' : '☆' }}</span>
        </div>
        <template v-if="hasWorker">
          <p class="text-sm text-(--color-text-muted)">امتیاز به {{ workerName }}</p>
          <div class="flex gap-1 text-2xl" data-testid="view-worker-rating-stars" aria-hidden="true">
            <span v-for="n in 5" :key="n">{{ n <= workerRating ? '⭐' : '☆' }}</span>
          </div>
        </template>
        <p v-if="comment" class="text-sm text-(--color-text-muted)">{{ comment }}</p>

        <div class="flex gap-2">
          <BaseButton variant="secondary" block data-testid="edit-review-button" @click="startEdit">
            ویرایش
          </BaseButton>
          <BaseButton variant="danger" block :loading="deleting" data-testid="delete-review-button" @click="deleteReview">
            حذف
          </BaseButton>
        </div>
      </template>

      <template v-else-if="phase === 'edit'">
        <h2 class="font-bold">ویرایش نظر</h2>
        <div class="flex gap-1 text-2xl" data-testid="edit-salon-rating-stars">
          <button v-for="n in 5" :key="n" type="button" @click="editRating = n">
            {{ n <= editRating ? '⭐' : '☆' }}
          </button>
        </div>
        <template v-if="hasWorker">
          <p class="text-sm text-(--color-text-muted)">امتیاز به {{ workerName }}</p>
          <div class="flex gap-1 text-2xl" data-testid="edit-worker-rating-stars">
            <button v-for="n in 5" :key="n" type="button" @click="editWorkerRating = n">
              {{ n <= editWorkerRating ? '⭐' : '☆' }}
            </button>
          </div>
        </template>
        <textarea
          v-model="editComment"
          placeholder="نظر شما (اختیاری)"
          class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30"
          rows="3"
        />
        <div class="flex gap-2">
          <BaseButton variant="secondary" block data-testid="cancel-edit-review-button" @click="phase = 'view'">
            انصراف
          </BaseButton>
          <BaseButton :loading="savingEdit" block data-testid="save-edit-review-button" @click="saveEdit">
            ذخیره
          </BaseButton>
        </div>
      </template>

      <template v-else>
        <h2 class="font-bold">این نوبت چطور بود؟</h2>
        <div class="flex gap-1 text-2xl" data-testid="salon-rating-stars">
          <button v-for="n in 5" :key="n" type="button" @click="rating = n">
            {{ n <= rating ? '⭐' : '☆' }}
          </button>
        </div>
        <template v-if="hasWorker">
          <p class="text-sm text-(--color-text-muted)">امتیاز به {{ workerName }}</p>
          <div class="flex gap-1 text-2xl" data-testid="worker-rating-stars">
            <button v-for="n in 5" :key="n" type="button" @click="workerRating = n">
              {{ n <= workerRating ? '⭐' : '☆' }}
            </button>
          </div>
        </template>
        <textarea
          v-model="comment"
          placeholder="نظر شما (اختیاری)"
          class="w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30"
          rows="3"
        />
        <BaseButton block :loading="submitting" data-testid="submit-review-button" @click="submit">
          ثبت نظر
        </BaseButton>
      </template>

      <button type="button" class="w-full text-sm text-(--color-text-muted)" @click="emit('close')">بستن</button>
    </BaseCard>
  </div>
</template>
