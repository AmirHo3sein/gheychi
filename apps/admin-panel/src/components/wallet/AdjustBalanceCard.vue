<!-- apps/admin-panel/src/components/wallet/AdjustBalanceCard.vue -->
<!-- Admin manual wallet adjustment (spec §4 "Wallet" / §8 "Wallet Ledger" -- POST
     /admin/wallet/adjust). This moves real balance, so submission is a two-step flow
     (fill form -> explicit confirm screen showing exactly what will happen), the same
     inline confirm-before-mutate shape CategoriesView.vue/CouponsView.vue already use for
     deletes, adapted here to confirm-before-submit instead of confirm-before-delete.

     User targeting mirrors UsersView.vue's own identifier field: phone (free-text, ILIKE
     match server-side via GET /admin/users?phone=), not userId -- a phone number is what
     an admin actually has on hand, and AdjustWalletDto still wants the resolved userId, so
     this resolves phone -> {id, phone, name} locally before submitting.

     Deliberately NOT silent on submit: a negative `amount` that would exceed the target
     user's balance comes back as a 400 ("Insufficient wallet balance for this debit"),
     which useApi surfaces through the standard toast path -- same reasoning as
     CouponsView.vue's create() for its own 409 case. -->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { usePhoneUserSearch } from '@/composables/usePhoneUserSearch'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import type { SelectOption } from '@/components/ui/AppSelect.vue'

const CURRENCY_OPTIONS: SelectOption[] = [
  { value: 'toman', label: 'تومان' },
  { value: 'points', label: 'امتیاز' },
]

const emit = defineEmits<{ adjusted: [result: { userId: string; balanceAfter: number }] }>()

const { apiFetch } = useApi()
const { push } = useToast()

const {
  root: phoneSearchRoot,
  phoneQuery,
  matches,
  selectedUser,
  searching,
  noResults,
  selectUser,
  clearUser,
} = usePhoneUserSearch()

const amount = ref<number | null>(null)
const currency = ref<'toman' | 'points'>('toman')
const reason = ref('')

// AppInput's model is string-typed (native <input> semantics) -- this bridges it to the
// number|null `amount` ref without changing anything downstream (canSubmit, the confirm
// summary, the request body) that already reads `amount.value` as a number.
const amountText = computed<string>({
  get: () => (amount.value === null ? '' : String(amount.value)),
  set: (value) => {
    if (value.trim() === '') {
      amount.value = null
      return
    }
    const parsed = Number(value)
    amount.value = Number.isNaN(parsed) ? null : parsed
  },
})

const confirming = ref(false)
const submitting = ref(false)

const canSubmit = computed(
  () => !!selectedUser.value && !!amount.value && amount.value !== 0 && reason.value.trim().length > 0,
)

// Focus management around the confirm step: moving in focuses the confirm heading (the
// form is fully replaced, so focus would otherwise silently stay on the now-gone "ثبت
// تعدیل" button); moving back out returns focus to that same button.
const confirmHeadingRef = ref<HTMLElement | null>(null)
const openConfirmButtonRef = ref<{ $el: HTMLElement } | null>(null)

async function askConfirm() {
  if (!canSubmit.value) return
  confirming.value = true
  await nextTick()
  confirmHeadingRef.value?.focus()
}

async function cancelConfirm() {
  confirming.value = false
  await nextTick()
  openConfirmButtonRef.value?.$el.focus()
}

function resetForm() {
  clearUser()
  amount.value = null
  currency.value = 'toman'
  reason.value = ''
  confirming.value = false
}

async function submit() {
  if (!selectedUser.value || !amount.value) return
  submitting.value = true
  const { data } = await apiFetch<{ balanceAfter: number }>('/admin/wallet/adjust', {
    method: 'POST',
    body: {
      userId: selectedUser.value.id,
      amount: amount.value,
      currency: currency.value,
      reason: reason.value.trim(),
    },
  })
  submitting.value = false
  if (data) {
    const target = selectedUser.value
    push(`موجودی «${target.name ?? target.phone}» به‌روزرسانی شد؛ موجودی جدید: ${data.balanceAfter.toLocaleString('fa-IR')}`)
    emit('adjusted', { userId: target.id, balanceAfter: data.balanceAfter })
    resetForm()
  } else {
    // Failed (e.g. debit exceeds balance) -- drop back to the editable form instead of
    // staying stuck on a confirm screen that just failed, so the admin can adjust the
    // amount and retry without re-picking the user.
    confirming.value = false
  }
}
</script>

<template>
  <AppCard>
    <p class="mb-3 flex items-center gap-2 text-sm font-semibold text-(--color-text)">
      <AppIcon name="wallet" :size="16" class="text-(--color-accent)" />
      تعدیل موجودی کیف پول
    </p>

    <div v-if="!confirming" class="space-y-3.5">
      <div class="flex flex-wrap items-end gap-2.5">
        <div ref="phoneSearchRoot" class="relative">
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">شماره موبایل کاربر</label>
          <div v-if="!selectedUser" class="w-48">
            <AppInput
              v-model="phoneQuery"
              data-testid="adjust-phone-input"
              icon="phone"
              placeholder="جست‌وجوی شماره موبایل…"
            />
            <p v-if="searching" class="mt-1 text-xs text-(--color-text-muted)">در حال جستجو…</p>
          </div>
          <div
            v-else
            data-testid="adjust-selected-user"
            class="flex w-48 items-center justify-between gap-2 rounded-xl border border-(--color-border) bg-(--color-border-soft) px-3 py-2.5 text-sm"
          >
            <span class="min-w-0 truncate">
              <span class="font-semibold text-(--color-text)">{{ selectedUser.name ?? selectedUser.phone }}</span>
              <span v-if="selectedUser.name" class="tnum text-xs text-(--color-text-muted)"> — {{ selectedUser.phone }}</span>
            </span>
            <button
              type="button"
              data-testid="adjust-clear-user"
              class="shrink-0 text-(--color-text-muted) hover:text-(--tone-danger-text)"
              title="تغییر کاربر"
              aria-label="تغییر کاربر"
              @click="clearUser"
            >
              <AppIcon name="x" :size="14" />
            </button>
          </div>

          <div
            v-if="matches.length > 0 || noResults"
            data-testid="adjust-user-matches"
            class="absolute start-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-md)"
          >
            <button
              v-for="user in matches"
              :key="user.id"
              type="button"
              class="block w-full px-3 py-2 text-right text-sm transition-colors hover:bg-(--color-border-soft)"
              @click="selectUser(user)"
            >
              <span class="font-semibold text-(--color-text)">{{ user.name ?? 'بدون نام' }}</span>
              <span class="tnum mr-1 text-xs text-(--color-text-muted)">{{ user.phone }}</span>
            </button>
            <p v-if="noResults" class="px-3 py-2 text-sm text-(--color-text-muted)">کاربری یافت نشد</p>
          </div>
        </div>

        <div class="w-40">
          <AppInput
            v-model="amountText"
            data-testid="adjust-amount-input"
            type="number"
            label="مبلغ (مثبت = واریز، منفی = برداشت)"
            placeholder="مثلا 50000 (واریز) یا -50000 (برداشت)"
            class="tnum"
          />
        </div>

        <div>
          <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">واحد</label>
          <AppSelect v-model="currency" :options="CURRENCY_OPTIONS" width="8rem" />
        </div>
      </div>

      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">دلیل (الزامی)</label>
        <textarea
          v-model="reason"
          data-testid="adjust-reason-input"
          placeholder="دلیل این تعدیل دستی را برای مستندسازی بنویسید…"
          rows="2"
          class="w-full max-w-xl rounded-xl border border-(--color-border) p-3 text-sm"
        />
      </div>

      <AppButton
        ref="openConfirmButtonRef"
        type="button"
        data-testid="adjust-open-confirm"
        :disabled="!canSubmit"
        @click="askConfirm"
      >
        <template #icon>
          <AppIcon name="wallet" :size="16" />
        </template>
        ثبت تعدیل
      </AppButton>
    </div>

    <div v-else class="space-y-3">
      <p ref="confirmHeadingRef" tabindex="-1" class="text-sm font-semibold text-(--tone-warning-text) outline-none">
        این عملیات موجودی واقعی کاربر را تغییر می‌دهد. لطفا جزئیات را بررسی و تایید کنید:
      </p>
      <ul class="tnum space-y-1 rounded-xl bg-(--color-border-soft) p-3.5 text-sm text-(--color-text)">
        <li><span class="font-semibold">کاربر:</span> {{ selectedUser?.name ?? selectedUser?.phone }} ({{ selectedUser?.phone }})</li>
        <li>
          <span class="font-semibold">مبلغ:</span>
          <span :class="(amount ?? 0) >= 0 ? 'text-(--tone-success-text)' : 'text-(--tone-danger-text)'">
            {{ (amount ?? 0) >= 0 ? '+' : '' }}{{ (amount ?? 0).toLocaleString('fa-IR') }}
          </span>
          {{ currency === 'toman' ? 'تومان' : 'امتیاز' }}
        </li>
        <li class="whitespace-pre-wrap"><span class="font-semibold">دلیل:</span> {{ reason }}</li>
      </ul>
      <div class="flex flex-wrap gap-2.5">
        <AppButton type="button" data-testid="adjust-confirm-submit" :disabled="submitting" @click="submit">
          تایید و ثبت
        </AppButton>
        <AppButton
          type="button"
          variant="ghost"
          data-testid="adjust-confirm-cancel"
          :disabled="submitting"
          @click="cancelConfirm"
        >
          انصراف
        </AppButton>
      </div>
    </div>
  </AppCard>
</template>
