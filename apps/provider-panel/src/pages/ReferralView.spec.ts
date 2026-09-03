import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeatureFlags, useFeatureFlags } from '@/composables/useFeatureFlags'
import { resetToast, useToast } from '@/composables/useToast'
import ReferralView from './ReferralView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const MY_CODE = { code: 'AB3CD7EF', isActive: true, shareUrl: 'http://localhost:3003/login?ref=AB3CD7EF' }

// Exactly as GET /referrals/mine returns rows -- INCLUDING the masked phone the API sends
// and this page must never render. Keeping it in the fixture is the point: the privacy test
// below is only meaningful if the data actually arrives.
const REFERRALS = {
  items: [
    { id: 'r1', referredUserPhoneMasked: '0912***4567', status: 'reward_granted', createdAt: '2026-07-01T09:00:00.000Z', rewardGrantedAt: '2026-07-05T09:00:00.000Z' },
    { id: 'r2', referredUserPhoneMasked: '0935***1122', status: 'awaiting_qualifying_event', createdAt: '2026-07-10T09:00:00.000Z', rewardGrantedAt: null },
    { id: 'r3', referredUserPhoneMasked: '0919***8888', status: 'awaiting_qualifying_event', createdAt: '2026-07-11T09:00:00.000Z', rewardGrantedAt: null },
  ],
  total: 3,
  page: 1,
  pageSize: 100,
}

const REWARDS = {
  items: [
    {
      id: 'rw1', referralId: 'r1', beneficiaryRole: 'referrer', rewardKind: 'wallet_credit',
      rewardValue: 50000, status: 'granted', grantedAt: '2026-07-05T09:00:00.000Z',
      walletTransactionId: 'wt1', couponId: null, currency: 'toman',
      couponCode: null, couponSalonId: null, couponSalonName: null, couponSalonSlug: null, couponExpiresAt: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
}

const BALANCES = { balances: [{ currency: 'toman', balance: 50000 }] }

const TRANSACTIONS = {
  items: [
    {
      id: 'wt1', userId: 'u1', currency: 'toman', amount: 50000, balanceAfter: 50000,
      type: 'referral_reward', referenceType: 'referral_reward', referenceId: 'rw1',
      reason: 'پاداش معرفی', createdAt: '2026-07-05T09:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
}

function stubHappyPath() {
  fetchMock.mockImplementation((path: string) => {
    if (path === '/referrals/my-code') return Promise.resolve({ data: structuredClone(MY_CODE), error: null })
    if (path.startsWith('/referrals/mine/rewards')) return Promise.resolve({ data: structuredClone(REWARDS), error: null })
    if (path.startsWith('/referrals/mine')) return Promise.resolve({ data: structuredClone(REFERRALS), error: null })
    if (path === '/wallet/mine') return Promise.resolve({ data: structuredClone(BALANCES), error: null })
    if (path.startsWith('/wallet/mine/transactions')) return Promise.resolve({ data: structuredClone(TRANSACTIONS), error: null })
    return Promise.resolve({ data: null, error: { status: 404, message: 'not found' } })
  })
}

function setReferralsEnabled(enabled: boolean) {
  useFeatureFlags().flags.value = {
    reviewsEnabled: true,
    storiesEnabled: true,
    portfolioEnabled: true,
    referralsEnabled: enabled,
    couponsEnabled: true,
    onlinePaymentEnabled: true,
  }
}

async function mountView() {
  const wrapper = mount(ReferralView)
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('ReferralView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    resetFeatureFlags()
    stubHappyPath()
  })

  it('renders the owner code, activity counts, granted rewards and wallet balance', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="referral-code"]').text()).toBe('AB3CD7EF')
    // Three referrals, split two ways -- counts, not people.
    expect(wrapper.get('[data-testid="referral-activity"]').text()).toContain((3).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="status-count-reward_granted"]').text()).toContain((1).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="status-count-awaiting_qualifying_event"]').text()).toContain((2).toLocaleString('fa-IR'))
    // A status nobody is in gets no permanently-zero cell.
    expect(wrapper.find('[data-testid="status-count-cancelled"]').exists()).toBe(false)

    expect(wrapper.get('[data-testid="reward-row"]').text()).toContain('اعتبار کیف پول')
    expect(wrapper.get('[data-testid="reward-row"]').text()).toContain((50000).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="wallet-balance"]').text()).toContain((50000).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="transaction-row"]').text()).toContain('پاداش معرفی')
  })

  // The whole reason the privacy note at the top of ReferralView.vue exists: the API hands
  // this page a masked phone for every referral and none of it may reach the DOM.
  it('never renders a referred person s phone number, masked or otherwise', async () => {
    const wrapper = await mountView()

    const rendered = wrapper.text()
    for (const referral of REFERRALS.items) {
      expect(rendered).not.toContain(referral.referredUserPhoneMasked)
    }
    // Not even a fragment of one -- a bare operator prefix would be enough to narrow it.
    expect(rendered).not.toContain('0912')
    expect(rendered).not.toContain('***')
  })

  it('copies the code and the share link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const wrapper = await mountView()

    await wrapper.get('[data-testid="copy-code"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).toHaveBeenCalledWith('AB3CD7EF')
    expect(useToast().toasts.value.at(-1)!.message).toContain('کد در کلیپ‌بورد')

    await wrapper.get('[data-testid="copy-link"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(writeText).toHaveBeenCalledWith(MY_CODE.shareUrl)
  })

  it('reports a refused clipboard instead of silently doing nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })

    const wrapper = await mountView()
    await wrapper.get('[data-testid="copy-code"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(useToast().toasts.value.at(-1)!.message).toContain('کپی ناموفق بود')
  })

  it('withholds the share code while the referral program is off, but keeps history and the balance', async () => {
    setReferralsEnabled(false)
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="referrals-disabled-banner"]').exists()).toBe(true)
    // Handing out a code that currently earns nothing is the one actively misleading thing
    // this page could do while the program is off.
    expect(wrapper.find('[data-testid="referral-code-card"]').exists()).toBe(false)
    // ...but the record of what already happened, and the money already earned, stay put.
    expect(wrapper.find('[data-testid="referral-activity"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="wallet-balance"]').text()).toContain((50000).toLocaleString('fa-IR'))
  })

  it('shows a retryable error for the referral half without hiding the wallet half', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/referrals/')) return Promise.resolve({ data: null, error: { status: 500, message: 'boom' } })
      if (path === '/wallet/mine') return Promise.resolve({ data: structuredClone(BALANCES), error: null })
      return Promise.resolve({ data: structuredClone(TRANSACTIONS), error: null })
    })

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('اطلاعات معرفی بارگذاری نشد.')
    expect(wrapper.find('[data-testid="referral-code-card"]').exists()).toBe(false)
    // The two halves fail independently -- a broken referral read must not blank a balance.
    expect(wrapper.get('[data-testid="wallet-balance"]').text()).toContain((50000).toLocaleString('fa-IR'))

    stubHappyPath()
    await wrapper.get('[data-testid="retry-referral"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="retry-referral"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="referral-code"]').text()).toBe('AB3CD7EF')
  })

  it('shows a retryable error for the wallet half rather than a zero balance', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/wallet/')) return Promise.resolve({ data: null, error: { status: 500, message: 'boom' } })
      if (path === '/referrals/my-code') return Promise.resolve({ data: structuredClone(MY_CODE), error: null })
      if (path.startsWith('/referrals/mine/rewards')) return Promise.resolve({ data: structuredClone(REWARDS), error: null })
      return Promise.resolve({ data: structuredClone(REFERRALS), error: null })
    })

    const wrapper = await mountView()

    // "موجودی: ۰" because a request failed would be a false claim about the owner's money.
    expect(wrapper.find('[data-testid="wallet-balance"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="retry-wallet"]').exists()).toBe(true)

    stubHappyPath()
    await wrapper.get('[data-testid="retry-wallet"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.get('[data-testid="wallet-balance"]').text()).toContain((50000).toLocaleString('fa-IR'))
  })

  it('renders a real zero balance (not an empty section) for an owner with no wallet rows yet', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/referrals/my-code') return Promise.resolve({ data: structuredClone(MY_CODE), error: null })
      if (path.startsWith('/referrals/mine/rewards')) return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
      if (path.startsWith('/referrals/mine')) return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 100 }, error: null })
      // wallet_balances rows only exist once a currency has actually moved, so a brand-new
      // owner legitimately gets an empty array here.
      if (path === '/wallet/mine') return Promise.resolve({ data: { balances: [] }, error: null })
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    })

    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="wallet-balance"]').text()).toContain((0).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="referral-activity"]').text()).toContain('هنوز کسی با کد شما ثبت‌نام نکرده است.')
    expect(wrapper.get('[data-testid="rewards-section"]').text()).toContain('هنوز پاداشی برای شما ثبت نشده است.')
  })

  it('admits when the status breakdown covers only the most recent page of referrals', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/referrals/my-code') return Promise.resolve({ data: structuredClone(MY_CODE), error: null })
      if (path.startsWith('/referrals/mine/rewards')) return Promise.resolve({ data: structuredClone(REWARDS), error: null })
      if (path.startsWith('/referrals/mine')) return Promise.resolve({ data: { ...structuredClone(REFERRALS), total: 250 }, error: null })
      if (path === '/wallet/mine') return Promise.resolve({ data: structuredClone(BALANCES), error: null })
      return Promise.resolve({ data: structuredClone(TRANSACTIONS), error: null })
    })

    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="counts-partial"]').exists()).toBe(true)
    // The total itself stays authoritative -- it comes straight from the API.
    expect(wrapper.get('[data-testid="referral-activity"]').text()).toContain((250).toLocaleString('fa-IR'))
  })

  it('asks for the referral list and rewards with explicit page sizes the API accepts', async () => {
    await mountView()

    const paths = fetchMock.mock.calls.map((c) => c[0] as string)
    expect(paths).toContain('/referrals/my-code')
    expect(paths).toContain('/referrals/mine?page=1&pageSize=100')
    expect(paths).toContain('/referrals/mine/rewards?page=1&pageSize=10')
    expect(paths).toContain('/wallet/mine')
    expect(paths).toContain('/wallet/mine/transactions?page=1&pageSize=10')
  })
})
