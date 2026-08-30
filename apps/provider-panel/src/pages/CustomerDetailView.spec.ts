import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import CustomerDetailView from './CustomerDetailView.vue'

// A factory, not a shared constant -- apiFetch's mocked json() returns this object by
// reference, and CustomerDetailView mutates `detail.value.notes` in place (unshift/filter),
// so a shared object would leak mutations from one test into the next.
function makeDetail() {
  return {
    customer: { id: 'u1', name: 'Ali', phone: '0912' },
    bookings: [
      { id: 'b1', startsAt: '2026-08-01T10:00:00.000Z', status: 'completed', priceSnapshot: 300_000, serviceName: 'کوتاهی مو' },
    ],
    notes: [{ id: 'n1', note: 'همیشه دیر می‌رسد', createdAt: '2026-08-01T10:00:00.000Z' }],
  }
}
function makeQuota() {
  return { quota: 20, used: 2, remaining: 18 }
}

async function mountView(fetchImpl: (url: string, opts?: { method?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: { method?: string }) => {
      if (url.includes('/sms-quota')) return Promise.resolve({ ok: true, status: 200, json: async () => makeQuota() })
      return fetchImpl(url, opts)
    }),
  )
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/customers/:id', component: CustomerDetailView }],
  })
  router.push('/customers/u1')
  await router.isReady()
  const wrapper = mount(CustomerDetailView, { global: { plugins: [router] } })
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('CustomerDetailView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the customer, their booking history, and existing notes', async () => {
    const wrapper = await mountView(async () => ({ ok: true, status: 200, json: async () => makeDetail() }))

    expect(wrapper.text()).toContain('Ali')
    expect(wrapper.text()).toContain('0912')
    const bookingRow = wrapper.get('[data-testid="customer-booking-row"]')
    expect(bookingRow.text()).toContain('کوتاهی مو')
    expect(bookingRow.text()).toContain('انجام شد')
    expect(wrapper.get('[data-testid="note-row"]').text()).toContain('همیشه دیر می‌رسد')
  })

  it('shows a not-found state for a customer that does not belong to this salon', async () => {
    const wrapper = await mountView(async () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }))

    expect(wrapper.text()).toContain('این مشتری برای سالن شما یافت نشد.')
  })

  it('shows a retryable error state for a non-404 failure', async () => {
    const wrapper = await mountView(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    expect(wrapper.find('[data-testid="retry-customer-detail"]').exists()).toBe(true)
  })

  it('adds a note and prepends it to the list', async () => {
    const wrapper = await mountView(async (url, opts) => {
      if (opts?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ id: 'n2', note: 'یادداشت جدید', createdAt: '2026-08-20T00:00:00.000Z' }) }
      }
      return { ok: true, status: 200, json: async () => makeDetail() }
    })

    await wrapper.get('[data-testid="new-note-input"]').setValue('یادداشت جدید')
    await wrapper.get('[data-testid="add-note-button"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const notes = wrapper.findAll('[data-testid="note-row"]')
    expect(notes).toHaveLength(2)
    expect(notes[0]!.text()).toContain('یادداشت جدید') // prepended, not appended
  })

  it('deletes a note and removes it from the list', async () => {
    const wrapper = await mountView(async (url, opts) => {
      if (opts?.method === 'DELETE') return { ok: true, status: 204, json: async () => undefined }
      return { ok: true, status: 200, json: async () => makeDetail() }
    })

    await wrapper.get('[data-testid="delete-note-n1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="note-row"]').exists()).toBe(false)
  })

  it('shows the remaining monthly SMS quota', async () => {
    const wrapper = await mountView(async () => ({ ok: true, status: 200, json: async () => makeDetail() }))

    const line = wrapper.get('[data-testid="sms-quota-remaining"]')
    expect(line.text()).toContain('18')
    expect(line.text()).toContain('20')
  })

  it('sends an SMS to the customer and updates the remaining quota from the response', async () => {
    const wrapper = await mountView(async (url, opts) => {
      if (url.includes('/sms') && opts?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ quota: 20, used: 3, remaining: 17 }) }
      }
      return { ok: true, status: 200, json: async () => makeDetail() }
    })

    await wrapper.get('[data-testid="sms-message-input"]').setValue('یادآوری نوبت شما')
    await wrapper.get('[data-testid="send-sms-button"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect((wrapper.get('[data-testid="sms-message-input"]').element as HTMLTextAreaElement).value).toBe('')
    const line = wrapper.get('[data-testid="sms-quota-remaining"]')
    expect(line.text()).toContain('17')
  })
})
