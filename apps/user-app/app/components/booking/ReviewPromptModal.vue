<script setup lang="ts">
const props = defineProps<{ bookingId: string }>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const { apiFetch } = useApi()
const rating = ref(5)
const comment = ref('')
const submitting = ref(false)
const alreadyReviewed = ref(false)

async function submit() {
  submitting.value = true
  const { error } = await apiFetch('/reviews', {
    method: 'POST',
    body: { bookingId: props.bookingId, rating: rating.value, comment: comment.value || undefined },
    silent: true,
  })
  submitting.value = false
  if (error?.status === 409) {
    alreadyReviewed.value = true
    return
  }
  if (!error) emit('submitted')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
    <div class="bg-(--color-surface-card) rounded-xl p-4 w-full max-w-sm space-y-3">
      <p v-if="alreadyReviewed" class="text-sm">شما قبلا برای این نوبت نظر ثبت کرده‌اید</p>
      <template v-else>
        <h2 class="font-bold">این نوبت چطور بود؟</h2>
        <div class="flex gap-1 text-2xl">
          <button v-for="n in 5" :key="n" type="button" @click="rating = n">
            {{ n <= rating ? '⭐' : '☆' }}
          </button>
        </div>
        <textarea v-model="comment" placeholder="نظر شما (اختیاری)" class="w-full rounded-lg border p-2 text-sm" rows="3" />
        <button type="button" :disabled="submitting" class="w-full rounded-lg bg-(--color-accent) text-white p-2 font-semibold" @click="submit">
          ثبت نظر
        </button>
      </template>
      <button type="button" class="w-full text-sm" @click="emit('close')">بستن</button>
    </div>
  </div>
</template>
