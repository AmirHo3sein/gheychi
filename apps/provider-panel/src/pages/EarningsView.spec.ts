import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EarningsView from './EarningsView.vue'

async function mountEarnings() {
  const wrapper = mount(EarningsView)
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
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

    // Retry re-issues the request and, on success, replaces the error state.
    fetchMock.mockClear()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        totalCollected: 1_000,
        commissionPercent: 10,
        commissionAmount: 100,
        netPayout: 900,
      }),
    })
    await wrapper.find('[data-testid="retry-earnings"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
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
})
