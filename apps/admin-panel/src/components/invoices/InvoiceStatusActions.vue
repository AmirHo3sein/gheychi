<!-- apps/admin-panel/src/components/invoices/InvoiceStatusActions.vue -->
<!-- "Record" a payment the admin already made outside the system (a bank transfer) --
     there is no payout infrastructure to initiate one from here. Same inline row-swap
     shape as SalonStatusActions.vue's reason field: a button opens the form, Submit
     commits via PATCH .../payment, Cancel discards and returns to the button. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMoneyInput from '@/components/ui/AppMoneyInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { formatToman } from '@/utils/format-toman'

// `remaining` (net payable minus already paid) lets the form refuse an over-large amount before
// it is sent; the API enforces the same limit, so omitting it only loses the early feedback.
const props = defineProps<{ invoiceId: string; status: 'issued' | 'partially_paid' | 'paid' | 'void'; remaining?: number }>()
const emit = defineEmits<{ recorded: [] }>()

const { apiFetch } = useApi()

const open = ref(false)
const amount = ref<number | null>(null)
const method = ref<'bank_transfer' | 'cash' | 'other'>('bank_transfer')
const referenceNumber = ref('')
const note = ref('')
const submitting = ref(false)
const amountError = ref<string | null>(null)

const METHOD_OPTIONS = [
  { value: 'bank_transfer', label: 'حواله بانکی' },
  { value: 'cash', label: 'نقدی' },
  { value: 'other', label: 'سایر' },
]

function openForm() {
  open.value = true
  amount.value = null
  method.value = 'bank_transfer'
  referenceNumber.value = ''
  note.value = ''
  amountError.value = null
}

async function submit() {
  if (!amount.value || amount.value <= 0) {
    amountError.value = 'مبلغ باید بزرگ‌تر از صفر باشد'
    return
  }
  if (props.remaining !== undefined && amount.value > props.remaining) {
    amountError.value = `مبلغ از مانده صورتحساب بیشتر است (حداکثر ${formatToman(props.remaining)} تومان)`
    return
  }
  submitting.value = true
  const { data } = await apiFetch(`/admin/invoices/${props.invoiceId}/payment`, {
    method: 'PATCH',
    body: {
      amount: amount.value,
      method: method.value,
      referenceNumber: referenceNumber.value.trim() || undefined,
      note: note.value.trim() || undefined,
    },
  })
  submitting.value = false
  if (data) {
    open.value = false
    emit('recorded')
  }
}
</script>

<template>
  <div>
    <AppButton
      v-if="!open"
      data-testid="record-payment-button"
      type="button"
      variant="primary"
      :disabled="status === 'paid' || status === 'void'"
      @click="openForm"
    >
      <template #icon><AppIcon name="plus" :size="16" /></template>
      ثبت پرداخت
    </AppButton>

    <div v-else class="space-y-3">
      <p v-if="remaining !== undefined" data-testid="payment-remaining" class="text-xs text-(--color-text-muted)">
        مانده قابل ثبت: <span class="tnum font-semibold text-(--color-text)">{{ formatToman(remaining) }}</span> تومان
      </p>
      <div class="flex flex-wrap items-end gap-2.5">
        <AppMoneyInput
          :model-value="amount === null ? '' : String(amount)"
          data-testid="payment-amount-input"
          label="مبلغ (تومان)"
          class="w-36"
          :error="amountError ?? undefined"
          @update:model-value="(v) => { amount = v === '' ? null : Number(v); amountError = null }"
        />
        <AppSelect v-model="method" label="روش پرداخت" :options="METHOD_OPTIONS" width="10rem" />
        <AppInput v-model="referenceNumber" data-testid="payment-reference-input" label="شماره پیگیری (اختیاری)" class="w-40" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">یادداشت (اختیاری)</label>
        <textarea
          v-model="note"
          data-testid="payment-note-input"
          rows="2"
          class="w-full rounded-xl border border-(--color-text-muted) p-3 text-sm"
        />
      </div>
      <div class="flex flex-wrap gap-2.5">
        <AppButton data-testid="submit-payment" type="button" variant="primary" :disabled="submitting" :loading="submitting" @click="submit">
          ثبت نهایی
        </AppButton>
        <AppButton type="button" variant="secondary" :disabled="submitting" @click="open = false">
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
