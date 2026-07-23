import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ReferralPage from '../../app/pages/account/referral.vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const MY_CODE = { code: 'AB3D9F2K', isActive: true, shareUrl: 'http://localhost:3003/login?ref=AB3D9F2K' }

const REFERRAL_AWAITING = {
  id: 'r1',
  referredUserPhoneMasked: '0912****567',
  status: 'awaiting_qualifying_event' as const,
  referralType: 'user' as const,
  createdAt: '2026-07-18T08:00:00.000Z',
  rewardGrantedAt: null,
}

const REFERRAL_CANCELLED = {
  id: 'r2',
  referredUserPhoneMasked: '0919****111',
  status: 'cancelled' as const,
  referralType: 'user' as const,
  createdAt: '2026-07-10T08:00:00.000Z',
  rewardGrantedAt: null,
}

const REFERRAL_PARTIALLY_GRANTED = {
  id: 'r3',
  referredUserPhoneMasked: '0935****222',
  status: 'partially_granted' as const,
  referralType: 'user' as const,
  createdAt: '2026-07-15T08:00:00.000Z',
  rewardGrantedAt: null,
}

const REWARD_WALLET_CREDIT = {
  id: 'rw1',
  referralId: 'r3',
  beneficiaryRole: 'referrer' as const,
  rewardKind: 'wallet_credit' as const,
  rewardValue: 20_000,
  status: 'granted' as const,
  grantedAt: '2026-07-18T08:00:00.000Z',
  walletTransactionId: 'wt1',
  couponId: null,
  currency: 'toman' as const,
  couponCode: null,
}

// Dispatch by URL -- the page fetches my-code, the referrals list, and the rewards
// list in the same setup.
function stub(
  myCode: unknown,
  items: unknown[],
  total: number,
  pageSize = 20,
  rewardItems: unknown[] = [],
  rewardTotal = 0,
) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/referrals/my-code') return myCode
    if (path === '/referrals/mine') return { items, total, page: 1, pageSize }
    if (path === '/referrals/mine/rewards') return { items: rewardItems, total: rewardTotal, page: 1, pageSize: 20 }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('account referral page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    // mountSuspended shares one Nuxt app instance across tests in this file, so the
    // 'referral-my-code'/'referrals-mine'/'referral-rewards-mine' useAsyncData payload
    // cache would otherwise leak the first test's response into the second mount
    // instead of re-fetching -- same reasoning as account-wallet.spec.ts.
    clearNuxtData(['referral-my-code', 'referrals-mine', 'referral-rewards-mine'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the code card and copies the code to the clipboard', async () => {
    stub(MY_CODE, [], 0)
    const wrapper = await mountSuspended(ReferralPage)

    expect(wrapper.find('[data-testid="referral-code"]').text()).toBe('AB3D9F2K')

    await wrapper.findAll('button').find((b) => b.text() === 'کپی کد')!.trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('AB3D9F2K')
  })

  it('copies the share link, not the bare code, from the invite-link button', async () => {
    stub(MY_CODE, [], 0)
    const wrapper = await mountSuspended(ReferralPage)

    await wrapper.findAll('button').find((b) => b.text() === 'کپی لینک دعوت')!.trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3003/login?ref=AB3D9F2K')
  })

  it('shows the empty state when nobody has redeemed the code yet', async () => {
    stub(MY_CODE, [], 0)
    const wrapper = await mountSuspended(ReferralPage)

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="referral-item"]').exists()).toBe(false)
  })

  it('lists referrals with masked phone, status label, and date', async () => {
    stub(MY_CODE, [REFERRAL_CANCELLED, REFERRAL_AWAITING], 2)
    const wrapper = await mountSuspended(ReferralPage)

    const rows = wrapper.findAll('[data-testid="referral-item"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('0919****111')
    expect(rows[0]!.find('[data-testid="referral-status"]').text()).toBe('لغو شده')
    expect(rows[1]!.text()).toContain('0912****567')
    expect(rows[1]!.find('[data-testid="referral-status"]').text()).toBe('در انتظار تکمیل رزرو')
  })

  it('renders an honest partial-grant label and explanation for a partially_granted referral, not a raw enum or "fully received"', async () => {
    stub(MY_CODE, [REFERRAL_PARTIALLY_GRANTED], 1)
    const wrapper = await mountSuspended(ReferralPage)

    const row = wrapper.find('[data-testid="referral-item"]')
    const statusText = row.find('[data-testid="referral-status"]').text()
    expect(statusText).not.toBe('partially_granted')
    expect(statusText).not.toContain('پاداش اعطا شد') // must not read as the full-grant label
    expect(statusText).toContain('جزئی')
    expect(row.text()).toContain('باقی')
  })

  it('shows pagination controls once results exceed one page', async () => {
    stub(MY_CODE, [REFERRAL_AWAITING], 45)
    const wrapper = await mountSuspended(ReferralPage)

    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prev-page"]').attributes('disabled')).toBeDefined()
  })

  it('shows the rewards empty state when nothing has been granted yet', async () => {
    stub(MY_CODE, [], 0, 20, [], 0)
    const wrapper = await mountSuspended(ReferralPage)

    expect(wrapper.find('[data-testid="rewards-empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reward-item"]').exists()).toBe(false)
  })

  it('lists rewards with kind, value, status, date, and a wallet link when a wallet_transaction_id is present', async () => {
    stub(MY_CODE, [], 0, 20, [REWARD_WALLET_CREDIT], 1)
    const wrapper = await mountSuspended(ReferralPage)

    const row = wrapper.find('[data-testid="reward-item"]')
    expect(row.find('[data-testid="reward-kind"]').text()).toBe('اعتبار کیف پول')
    expect(row.find('[data-testid="reward-value"]').text()).toContain('۲۰٬۰۰۰')
    expect(row.find('[data-testid="reward-value"]').text()).toContain('تومان')
    expect(row.find('[data-testid="reward-status"]').text()).toBe('اعطا شده')
    expect(row.find('a').attributes('href')).toBe('/account/wallet')
  })

  it('does not render a wallet link for a reward with no wallet_transaction_id', async () => {
    const couponReward = { ...REWARD_WALLET_CREDIT, walletTransactionId: null, currency: null, couponCode: 'REF-AB12' }
    stub(MY_CODE, [], 0, 20, [couponReward], 1)
    const wrapper = await mountSuspended(ReferralPage)

    const row = wrapper.find('[data-testid="reward-item"]')
    expect(row.find('a').exists()).toBe(false)
    expect(row.text()).toContain('REF-AB12')
  })

  it('lets the user copy a coupon-kind reward\'s code and jump to the salon list to redeem it', async () => {
    const couponReward = { ...REWARD_WALLET_CREDIT, walletTransactionId: null, currency: null, couponCode: 'REF-AB12' }
    stub(MY_CODE, [], 0, 20, [couponReward], 1)
    const wrapper = await mountSuspended(ReferralPage)

    const useCouponButton = wrapper.find('[data-testid="use-coupon-button"]')
    expect(useCouponButton.exists()).toBe(true)
    await useCouponButton.trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('REF-AB12')
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })

  it('does not render the use-coupon affordance for a wallet-kind reward', async () => {
    stub(MY_CODE, [], 0, 20, [REWARD_WALLET_CREDIT], 1)
    const wrapper = await mountSuspended(ReferralPage)

    expect(wrapper.find('[data-testid="use-coupon-button"]').exists()).toBe(false)
  })
})
