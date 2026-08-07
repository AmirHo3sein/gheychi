<script setup lang="ts">
interface ReviewResponse {
  id: string
  rating: number
  comment: string | null
}

// The caller's own existing review for this booking, as returned by GET /reviews/mine
// (ReviewsService.MyReviewListItem, narrowed to what this dialog renders). `canEdit` is
// the server's own edit-window verdict -- computed from platform_config's
// review_edit_window_hours, never re-derived here -- so the edit/delete controls are
// shown exactly when PATCH/DELETE would actually be accepted.
interface ExistingReview {
  id: string
  rating: number
  comment: string | null
  workerRating: number | null
  canEdit: boolean
}

const props = defineProps<{ bookingId: string; workerName?: string | null; review?: ExistingReview | null }>()
// `changed` fires after any successful create/edit/delete so the opening screen can
// refresh its review snapshot; `submitted` stays the create-only signal it always was.
const emit = defineEmits<{ close: []; submitted: []; changed: [] }>()

const { apiFetch } = useApi()

// 'form' -- initial create form (no review exists yet)
// 'view' -- a review exists: read display, with edit/delete actions while still editable
// 'edit' -- pre-filled edit form
// 'deleted' -- confirmation after a successful delete
// 'already-reviewed' -- 409 on create. Now only reachable when the caller's snapshot is
// stale (reviewed in another tab/device since this screen loaded), since a known review
// is passed in as `review` and opens straight into 'view'.
const phase = ref<'form' | 'view' | 'edit' | 'deleted' | 'already-reviewed'>(props.review ? 'view' : 'form')

const hasWorker = computed(() => !!props.workerName)

const reviewId = ref<string | null>(props.review?.id ?? null)
const rating = ref(props.review?.rating ?? 5)
// Falls back to 5 (the create form's default) when the booking has a worker but the
// existing review carries no worker score -- an older review from before worker ratings,
// which the API rejects a workerRating patch for anyway (400, no linked WorkerRating).
const workerRating = ref(props.review?.workerRating ?? 5)
const comment = ref(props.review?.comment ?? '')
// A review created in this session is by definition inside the edit window.
const canEdit = ref(props.review ? props.review.canEdit : true)
// Distinguishes "you just left this review" from "here is the review you left earlier",
// which are the same 'view' phase but not the same message.
const justSubmitted = ref(false)

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
    justSubmitted.value = true
    phase.value = 'view'
    emit('submitted')
    emit('changed')
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
    emit('changed')
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
  if (!error) {
    phase.value = 'deleted'
    emit('changed')
  }
}

function close() {
  emit('close')
}

const dialogRoot = ref<HTMLElement | null>(null)
const { titleId } = useDialog(dialogRoot, { onClose: close })
</script>

<template>
  <!-- items-start + my-auto rather than items-center, plus overflow-y-auto: the create/edit
       phases stack a title, two star rows, a 3-row textarea and up to three buttons -- around
       330px, which already fills a phone in landscape (~360px tall) and overflows it the
       moment the keyboard opens for the comment. Centering an overflowing flex item pushes
       its top off-screen unreachably; a cross-axis auto margin centers identically when
       there IS free space and collapses to zero when there isn't, leaving a plain scroll
       that reaches "ثبت نظر" and "بستن". -->
  <div class="fixed inset-0 bg-black/40 flex items-start justify-center overflow-y-auto overscroll-contain p-4 z-50">
    <div
      ref="dialogRoot"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      class="my-auto w-full max-w-sm space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm) outline-none"
    >
      <template v-if="phase === 'already-reviewed'">
        <h2 :id="titleId" class="text-sm font-bold">شما قبلا برای این نوبت نظر ثبت کرده‌اید</h2>
        <p class="text-sm text-(--color-text-muted)">
          برای مشاهده یا ویرایش آن، صفحه را تازه‌سازی کنید.
        </p>
      </template>

      <template v-else-if="phase === 'deleted'">
        <h2 :id="titleId" class="text-sm font-bold">نظر شما حذف شد</h2>
      </template>

      <template v-else-if="phase === 'view'">
        <h2 :id="titleId" class="font-bold">{{ justSubmitted ? 'نظر شما ثبت شد' : 'نظر شما برای این نوبت' }}</h2>
        <div class="flex gap-1" data-testid="view-salon-rating-stars" aria-hidden="true">
          <BaseIcon
            v-for="n in 5"
            :key="n"
            name="star"
            :size="24"
            :class="n <= rating ? 'text-(--color-accent-text)' : 'text-(--color-border)'"
          />
        </div>
        <template v-if="hasWorker">
          <p class="text-sm text-(--color-text-muted)">امتیاز به {{ workerName }}</p>
          <div class="flex gap-1" data-testid="view-worker-rating-stars" aria-hidden="true">
            <BaseIcon
              v-for="n in 5"
              :key="n"
              name="star"
              :size="24"
              :class="n <= workerRating ? 'text-(--color-accent-text)' : 'text-(--color-border)'"
            />
          </div>
        </template>
        <p v-if="comment" class="text-sm break-words text-(--color-text-muted)">{{ comment }}</p>

        <div v-if="canEdit" class="flex gap-2">
          <BaseButton variant="secondary" block data-testid="edit-review-button" @click="startEdit">
            ویرایش
          </BaseButton>
          <BaseButton variant="danger" block :loading="deleting" data-testid="delete-review-button" @click="deleteReview">
            حذف
          </BaseButton>
        </div>
        <!-- Same wording the API answers a late PATCH/DELETE with, so the reason a
             control is missing is stated rather than left to be guessed at. -->
        <p v-else data-testid="edit-window-closed" class="text-sm text-(--color-text-muted)">
          مهلت ویرایش این نظر به پایان رسیده است
        </p>
      </template>

      <template v-else-if="phase === 'edit'">
        <h2 :id="titleId" class="font-bold">ویرایش نظر</h2>
        <div class="flex gap-1" data-testid="edit-salon-rating-stars">
          <button
            v-for="n in 5"
            :key="n"
            type="button"
            :aria-label="`امتیاز ${n} از ۵ به سالن`"
            class="flex h-11 w-11 items-center justify-center"
            @click="editRating = n"
          >
            <BaseIcon name="star" :size="24" :class="n <= editRating ? 'text-(--color-accent-text)' : 'text-(--color-border)'" />
          </button>
        </div>
        <template v-if="hasWorker">
          <p class="text-sm text-(--color-text-muted)">امتیاز به {{ workerName }}</p>
          <div class="flex gap-1" data-testid="edit-worker-rating-stars">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              :aria-label="`امتیاز ${n} از ۵ به ${workerName}`"
              class="flex h-11 w-11 items-center justify-center"
              @click="editWorkerRating = n"
            >
              <BaseIcon name="star" :size="24" :class="n <= editWorkerRating ? 'text-(--color-accent-text)' : 'text-(--color-border)'" />
            </button>
          </div>
        </template>
        <textarea
          v-model="editComment"
          placeholder="نظر شما (اختیاری)"
          class="w-full resize-y rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30"
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
        <h2 :id="titleId" class="font-bold">این نوبت چطور بود؟</h2>
        <div class="flex gap-1" data-testid="salon-rating-stars">
          <button
            v-for="n in 5"
            :key="n"
            type="button"
            :aria-label="`امتیاز ${n} از ۵ به سالن`"
            class="flex h-11 w-11 items-center justify-center"
            @click="rating = n"
          >
            <BaseIcon name="star" :size="24" :class="n <= rating ? 'text-(--color-accent-text)' : 'text-(--color-border)'" />
          </button>
        </div>
        <template v-if="hasWorker">
          <p class="text-sm text-(--color-text-muted)">امتیاز به {{ workerName }}</p>
          <div class="flex gap-1" data-testid="worker-rating-stars">
            <button
              v-for="n in 5"
              :key="n"
              type="button"
              :aria-label="`امتیاز ${n} از ۵ به ${workerName}`"
              class="flex h-11 w-11 items-center justify-center"
              @click="workerRating = n"
            >
              <BaseIcon name="star" :size="24" :class="n <= workerRating ? 'text-(--color-accent-text)' : 'text-(--color-border)'" />
            </button>
          </div>
        </template>
        <textarea
          v-model="comment"
          placeholder="نظر شما (اختیاری)"
          class="w-full resize-y rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/30"
          rows="3"
        />
        <BaseButton block :loading="submitting" data-testid="submit-review-button" @click="submit">
          ثبت نظر
        </BaseButton>
      </template>

      <button type="button" class="min-h-11 w-full text-sm text-(--color-text-muted)" @click="close">بستن</button>
    </div>
  </div>
</template>
