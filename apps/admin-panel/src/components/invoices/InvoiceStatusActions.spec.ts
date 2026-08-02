import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoiceStatusActions from './InvoiceStatusActions.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('InvoiceStatusActions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows the record-payment button, disabled once the invoice is already paid', () => {
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'paid' } })

    const button = wrapper.get('[data-testid="record-payment-button"]')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('shows the record-payment button, disabled once the invoice is void', () => {
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'void' } })

    expect(wrapper.get('[data-testid="record-payment-button"]').attributes('disabled')).toBeDefined()
  })

  it('leaves the button enabled for issued/partially_paid invoices', () => {
    const issued = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'issued' } })
    expect(issued.get('[data-testid="record-payment-button"]').attributes('disabled')).toBeUndefined()

    const partial = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'partially_paid' } })
    expect(partial.get('[data-testid="record-payment-button"]').attributes('disabled')).toBeUndefined()
  })

  it('opens the form without calling the API on the first click', async () => {
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'issued' } })

    await wrapper.get('[data-testid="record-payment-button"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="submit-payment"]').exists()).toBe(true)
  })

  it('does not submit with a zero/empty amount -- shows a validation error instead', async () => {
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'issued' } })

    await wrapper.get('[data-testid="record-payment-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-payment"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('مبلغ باید بزرگ‌تر از صفر باشد')
  })

  it('submits amount/method/referenceNumber/note and emits recorded on success', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'inv-1', status: 'partially_paid' }, error: null })
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'issued' } })

    await wrapper.get('[data-testid="record-payment-button"]').trigger('click')
    await wrapper.get('[data-testid="payment-amount-input"]').setValue('40000')
    await wrapper.get('[data-testid="payment-reference-input"]').setValue('REF-123')
    await wrapper.get('[data-testid="payment-note-input"]').setValue('واریز اول')
    await wrapper.get('[data-testid="submit-payment"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/invoices/inv-1/payment', {
      method: 'PATCH',
      body: { amount: 40000, method: 'bank_transfer', referenceNumber: 'REF-123', note: 'واریز اول' },
    })
    expect(wrapper.emitted('recorded')).toBeTruthy()
    // Form closes back to the trigger button after a successful submit.
    expect(wrapper.find('[data-testid="record-payment-button"]').exists()).toBe(true)
  })

  it('does not emit recorded and keeps the form open when the API call fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 400, message: 'خطا' } })
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'issued' } })

    await wrapper.get('[data-testid="record-payment-button"]').trigger('click')
    await wrapper.get('[data-testid="payment-amount-input"]').setValue('40000')
    await wrapper.get('[data-testid="submit-payment"]').trigger('click')

    expect(wrapper.emitted('recorded')).toBeFalsy()
    expect(wrapper.find('[data-testid="submit-payment"]').exists()).toBe(true)
  })

  it('cancelling the form discards input and returns to the trigger button without calling the API', async () => {
    const wrapper = mount(InvoiceStatusActions, { props: { invoiceId: 'inv-1', status: 'issued' } })

    await wrapper.get('[data-testid="record-payment-button"]').trigger('click')
    await wrapper.get('[data-testid="payment-amount-input"]').setValue('40000')
    await wrapper.findAll('button').find((b) => b.text() === 'انصراف')!.trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="record-payment-button"]').exists()).toBe(true)
  })
})
