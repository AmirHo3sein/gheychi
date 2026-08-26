import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ActivityPage from '../../app/pages/account/activity.vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const BOOKING_ITEM = {
  type: 'booking',
  id: 'b1',
  occurredAt: '2026-08-01T09:00:00.000Z',
  detail: {
    status: 'completed',
    source: 'online',
    salonName: 'سالن نمونه',
    serviceName: 'کوتاهی مو',
    workerName: null,
    startsAt: '2026-08-01T10:00:00.000Z',
    priceSnapshot: 300_000,
  },
}

const WALLET_ITEM = {
  type: 'wallet_transaction',
  id: 'w1',
  occurredAt: '2026-08-02T09:00:00.000Z',
  detail: { type: 'referral_reward', amount: 50_000, balanceAfter: 50_000, reason: null },
}

const REVIEW_ITEM = {
  type: 'review',
  id: 'r1',
  occurredAt: '2026-08-03T09:00:00.000Z',
  detail: { rating: 5, comment: 'عالی بود', status: 'published', salonName: 'سالن نمونه', bookingId: 'b1' },
}

const REWARD_ITEM = {
  type: 'referral_reward',
  id: 'rr1',
  occurredAt: '2026-08-04T09:00:00.000Z',
  detail: { beneficiaryRole: 'referrer', rewardKind: 'wallet_credit', rewardValue: 50_000, status: 'granted' },
}

describe('account activity page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one card per activity type with its own summary line', async () => {
    fetchMock.mockResolvedValue({
      items: [REWARD_ITEM, REVIEW_ITEM, WALLET_ITEM, BOOKING_ITEM],
      nextCursor: null,
      hasMore: false,
    })
    const wrapper = await mountSuspended(ActivityPage)
    await flushPromises()

    const cards = wrapper.findAll('[data-testid="activity-item"]')
    expect(cards).toHaveLength(4)
    expect(cards[0]!.text()).toContain('اعتبار کیف پول')
    expect(cards[1]!.text()).toContain('سالن نمونه')
    expect(cards[1]!.text()).toContain('عالی بود')
    expect(cards[2]!.text()).toContain('پاداش معرفی')
    expect(cards[2]!.find('[data-testid="activity-wallet-amount"]').text()).toContain('+۵۰٬۰۰۰')
    expect(cards[3]!.text()).toContain('سالن نمونه — کوتاهی مو')
    expect(cards[3]!.text()).toContain('انجام شده')
  })

  it('shows the empty state when there is no activity at all', async () => {
    fetchMock.mockResolvedValue({ items: [], nextCursor: null, hasMore: false })
    const wrapper = await mountSuspended(ActivityPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="activity-empty-state"]').exists()).toBe(true)
  })

  it('shows a retry state on a failed load', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 } })
    const wrapper = await mountSuspended(ActivityPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="activity-load-error"]').exists()).toBe(true)

    fetchMock.mockResolvedValue({ items: [BOOKING_ITEM], nextCursor: null, hasMore: false })
    await wrapper.find('[data-testid="activity-retry-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="activity-load-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="activity-item"]')).toHaveLength(1)
  })

  it('appends more items and updates the cursor on "بارگذاری بیشتر", hiding the button once hasMore is false', async () => {
    fetchMock.mockResolvedValueOnce({ items: [BOOKING_ITEM], nextCursor: '2026-08-01T09:00:00.000Z', hasMore: true })
    const wrapper = await mountSuspended(ActivityPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="activity-load-more"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ items: [WALLET_ITEM], nextCursor: null, hasMore: false })
    await wrapper.find('[data-testid="activity-load-more"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/activity/mine',
      expect.objectContaining({ query: { cursor: '2026-08-01T09:00:00.000Z' } }),
    )
    expect(wrapper.findAll('[data-testid="activity-item"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="activity-load-more"]').exists()).toBe(false)
  })
})
