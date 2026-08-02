import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EarningsView from './EarningsView.vue'

const EARNINGS_BODY = { totalCollected: 5_000_000, commissionPercent: 10, commissionAmount: 500_000, netPayout: 4_500_000 }

async function mountEarnings() {
  const wrapper = mount(EarningsView)
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

// Routes by URL rather than call order, so a test can pin the earnings and invoices
// responses independently regardless of which Promise.all leg resolves first.
function stubFetchByUrl(responses: { earnings?: unknown; invoices?: unknown }) {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/salons/mine/invoices')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => responses.invoices ?? [] })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => responses.earnings ?? EARNINGS_BODY })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('EarningsView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the earnings figures on a successful fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        totalCollected: 5_000_000,
        commissionPercent: 10,
        commissionAmount: 500_000,
        netPayout: 4_500_000,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountEarnings()

    expect(wrapper.text()).toContain('مجموع دریافتی')
    expect(wrapper.text()).toContain('مبلغ قابل پرداخت')
    expect(wrapper.find('[data-testid="retry-earnings"]').exists()).toBe(false)
  })

  it('renders a retry-capable error state (not a blank page) when the fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'خطای سرور' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountEarnings()

    expect(wrapper.text()).toContain('اطلاعات درآمد بارگذاری نشد.')
    expect(wrapper.find('[data-testid="retry-earnings"]').exists()).toBe(true)

    // Retry re-issues the request and, on success, replaces the error state. Routed
    // by URL (not a single blanket resolution) -- the invoices endpoint returns an
    // array, and reusing the earnings object for it would silently v-for over its own
    // property values instead.
    fetchMock.mockClear()
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/salons/mine/invoices')) return Promise.resolve({ ok: true, status: 200, json: async () => [] })
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ totalCollected: 1_000, commissionPercent: 10, commissionAmount: 100, netPayout: 900 }),
      })
    })
    await wrapper.find('[data-testid="retry-earnings"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    // load() fires two requests every call now (earnings + invoices, in parallel).
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="retry-earnings"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('مجموع دریافتی')
  })

  it('shows the empty state instead of crashing when the API returns no data', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => null,
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountEarnings()

    expect(wrapper.text()).toContain('اطلاعات درآمدی برای نمایش وجود ندارد.')
  })

  it('renders a dash instead of "NaN تومان" when a money field is null or missing', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        totalCollected: null,
        commissionPercent: 10,
        commissionAmount: undefined,
        netPayout: Number.NaN,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountEarnings()

    expect(wrapper.text()).not.toContain('NaN')
    expect(wrapper.text()).toContain('—')
  })

  it('shows the empty state for the invoice history when there are no invoices yet', async () => {
    stubFetchByUrl({ invoices: [] })

    const wrapper = await mountEarnings()

    expect(wrapper.text()).toContain('هنوز صورتحسابی صادر نشده است.')
  })

  it('renders each invoice with its period, net-payable amount, paid-total, and status badge', async () => {
    stubFetchByUrl({
      invoices: [
        { id: 'inv-1', jalaliYear: 1403, jalaliMonth: 5, totalNetPayable: 300_000, paidTotal: 300_000, status: 'paid' },
        { id: 'inv-2', jalaliYear: 1403, jalaliMonth: 6, totalNetPayable: 120_000, paidTotal: 0, status: 'issued' },
      ],
    })

    const wrapper = await mountEarnings()

    const rows = wrapper.findAll('[data-testid="invoice-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('مرداد')
    expect(rows[0]!.text()).toContain((300_000).toLocaleString('fa-IR'))
    expect(rows[0]!.text()).toContain('پرداخت‌شده')
    expect(rows[1]!.text()).toContain('شهریور')
    expect(rows[1]!.text()).toContain('صادرشده')
  })

  it('shows an inline error for the invoice history without blanking the earnings figures', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/salons/mine/invoices')) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
      return Promise.resolve({ ok: true, status: 200, json: async () => EARNINGS_BODY })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountEarnings()

    expect(wrapper.text()).toContain('مجموع دریافتی') // earnings still rendered
    expect(wrapper.text()).toContain('تاریخچه تسویه‌حساب بارگذاری نشد.')
  })
})
