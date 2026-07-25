import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReferralsView from './ReferralsView.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const referral = {
  id: 'ref-1',
  referralType: 'user',
  status: 'awaiting_qualifying_event',
  referrerUserId: 'u-referrer',
  referrerPhone: '09121234567',
  referredUserId: 'u-referred',
  referredUserPhoneMasked: '0913***0003',
  salonId: null,
  qualifyingEvent: 'first_paid_booking',
  expiresAt: null,
  rewardGrantedAt: null,
  cancelledReason: null,
  createdAt: '2026-07-21T08:00:00.000Z',
  referrerRewardKind: 'wallet_credit',
  referrerRewardValue: 50000,
  referrerRewardMax: null,
  referredRewardKind: 'percent_discount',
  referredRewardValue: 10,
  referredRewardMax: 20000,
}

describe('ReferralsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads referrals with no filters by default and renders the row', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...referral }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/referrals?page=1&pageSize=20', { silent: true })
    expect(wrapper.text()).toContain('09121234567')
    expect(wrapper.text()).toContain('0913***0003')
    expect(wrapper.text()).toContain('در انتظار رویداد')
    expect(wrapper.text()).toContain('کاربر عادی')
  })

  it('shows the Cancel action only for a referral awaiting its qualifying event', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [
          { ...referral, id: 'ref-awaiting', status: 'awaiting_qualifying_event' },
          { ...referral, id: 'ref-cancelled', status: 'cancelled', cancelledReason: 'fraud' },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
      error: null,
    })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    const cancelButtons = wrapper.findAll('[data-testid="cancel-referral-button"]')
    expect(cancelButtons).toHaveLength(1)
  })

  it('sends the status/type/referrerPhone filters and resets to page 1 on change', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...referral }], total: 25, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    wrapper.findComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/referrals?page=2&pageSize=20', { silent: true })

    fetchMock.mockClear()
    // First AppSelect is the status filter (rendered before the type filter in the template).
    wrapper.findAllComponents(AppSelect)[0].vm.$emit('update:modelValue', 'cancelled')
    await flushPromises()

    // The page reset rides along with the filter change -- a single request, not two.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/referrals?page=1&pageSize=20&status=cancelled', { silent: true })
  })

  it('filters by referral type', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    fetchMock.mockClear()
    wrapper.findAllComponents(AppSelect)[1].vm.$emit('update:modelValue', 'worker')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/referrals?page=1&pageSize=20&referralType=worker', { silent: true })
  })

  it('cancels a referral and reflects the new status/reason in the row without a reload', async () => {
    fetchMock.mockResolvedValueOnce({ data: { items: [{ ...referral }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    fetchMock.mockResolvedValueOnce({
      data: { id: 'ref-1', status: 'cancelled', cancelledReason: 'fraud suspected' },
      error: null,
    })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('fraud suspected')
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')
    await wrapper.get('[data-testid="cancel-referral-confirm"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/referrals/ref-1/cancel', {
      method: 'PATCH',
      body: { reason: 'fraud suspected' },
    })
    // Only the list GET + the cancel PATCH fired -- no extra reload needed on success.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('لغو شده')
    expect(wrapper.find('[data-testid="cancel-referral-button"]').exists()).toBe(false)
  })

  it('reloads the list when the cancel PATCH fails (409 lost race)', async () => {
    fetchMock.mockResolvedValueOnce({ data: { items: [{ ...referral }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'این ارجاع دیگر در وضعیت در انتظار رویداد نیست' } })
    fetchMock.mockResolvedValueOnce({
      data: { items: [{ ...referral, status: 'expired' }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })

    await wrapper.get('[data-testid="cancel-referral-button"]').trigger('click')
    await wrapper.get('[data-testid="cancel-reason-input"]').setValue('too late')
    await wrapper.get('[data-testid="cancel-referral-submit"]').trigger('click')
    await wrapper.get('[data-testid="cancel-referral-confirm"]').trigger('click')
    await flushPromises()

    const listCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/referrals?'))
    expect(listCalls).toHaveLength(2)
    expect(wrapper.text()).toContain('منقضی شده')
  })

  it('filters by the partially_granted status and renders its label/tone', async () => {
    fetchMock.mockResolvedValue({
      data: { items: [{ ...referral, id: 'ref-partial', status: 'partially_granted' }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    expect(wrapper.text()).toContain('اعطای جزئی پاداش')

    fetchMock.mockClear()
    wrapper.findAllComponents(AppSelect)[0].vm.$emit('update:modelValue', 'partially_granted')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/referrals?page=1&pageSize=20&status=partially_granted', { silent: true })
  })

  it('does not show the Cancel action for a partially_granted referral', async () => {
    fetchMock.mockResolvedValue({
      data: { items: [{ ...referral, id: 'ref-partial', status: 'partially_granted' }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="cancel-referral-button"]').exists()).toBe(false)
  })

  it('shows the empty state when there are no matching referrals', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    expect(wrapper.text()).toContain('معرفی‌ای با این فیلترها یافت نشد.')
  })

  it('shows the full available snapshot, including reward terms for both sides, in the row details panel', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [
          {
            ...referral,
            salonId: 'salon-123456',
            expiresAt: '2026-08-01T00:00:00.000Z',
            qualifyingEvent: 'first_paid_booking',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      error: null,
    })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    const details = wrapper.get('[data-testid="referral-details"]')
    expect(details.text()).toContain('اولین نوبت پرداخت‌شده')
    expect(details.text()).toContain('salon-12')
    // Reward terms (kind/value/max) are on the row itself (Slice 5 projection) -- no
    // fetch needed to show these, unlike the per-side grant/reversal detail below.
    expect(details.text()).toContain('اعتبار کیف پول')
    expect(details.text()).toContain('تخفیف درصدی')
  })

  it('does not fetch the per-referral rewards detail until the row is expanded', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...referral }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith('/admin/referrals/ref-1/rewards', { silent: true })
  })

  it('fetches and renders the per-side rewards detail on row expand, only once', async () => {
    fetchMock.mockResolvedValueOnce({ data: { items: [{ ...referral }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    fetchMock.mockResolvedValueOnce({
      data: [
        {
          id: 'rr-1',
          beneficiaryRole: 'referrer',
          beneficiaryUserId: 'u-referrer',
          rewardKind: 'wallet_credit',
          rewardValue: 50000,
          status: 'granted',
          grantedAt: '2026-07-22T10:00:00.000Z',
          reversedAt: null,
          reversalReason: null,
          reversalShortfallAmount: null,
          walletTransactionId: 'wtx-1',
          couponId: null,
          couponCode: null,
          couponIsActive: null,
        },
        {
          id: 'rr-2',
          beneficiaryRole: 'referred',
          beneficiaryUserId: 'u-referred',
          rewardKind: 'percent_discount',
          rewardValue: 10,
          status: 'granted',
          grantedAt: '2026-07-22T10:00:00.000Z',
          reversedAt: null,
          reversalReason: null,
          reversalShortfallAmount: null,
          walletTransactionId: null,
          couponId: 'coupon-1',
          couponCode: 'REF-AB12CD',
          couponIsActive: true,
        },
      ],
      error: null,
    })

    await wrapper.get('summary').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/referrals/ref-1/rewards', { silent: true })

    const referrerStatus = wrapper.get('[data-testid="reward-status-referrer"]')
    expect(referrerStatus.text()).toContain('اعطا شد')

    const referredStatus = wrapper.get('[data-testid="reward-status-referred"]')
    expect(referredStatus.text()).toContain('اعطا شد')
    expect(referredStatus.text()).toContain('REF-AB12CD')
    expect(referredStatus.text()).toContain('فعال')
    // The actual resolved discount (rewardKind/rewardValue on the grant itself, distinct
    // from the configured referral-row terms) renders alongside the coupon code.
    expect(referredStatus.text()).toContain('٪۱۰')

    fetchMock.mockClear()
    await wrapper.get('summary').trigger('click')
    await flushPromises()
    // Second expand of the same row must not refetch -- the response is cached.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a fixed_discount coupon reward\'s resolved toman amount distinctly from a percent one', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { items: [{ ...referral, referredRewardKind: 'fixed_discount', referredRewardValue: 50000 }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    fetchMock.mockResolvedValueOnce({
      data: [
        {
          id: 'rr-4',
          beneficiaryRole: 'referred',
          beneficiaryUserId: 'u-referred',
          rewardKind: 'fixed_discount',
          rewardValue: 50000,
          status: 'granted',
          grantedAt: '2026-07-22T10:00:00.000Z',
          reversedAt: null,
          reversalReason: null,
          reversalShortfallAmount: null,
          walletTransactionId: null,
          couponId: 'coupon-2',
          couponCode: 'REF-FIX123',
          couponIsActive: true,
        },
      ],
      error: null,
    })

    await wrapper.get('summary').trigger('click')
    await flushPromises()

    const referredStatus = wrapper.get('[data-testid="reward-status-referred"]')
    expect(referredStatus.text()).toContain('REF-FIX123')
    expect(referredStatus.text()).toContain(`${(50000).toLocaleString('fa-IR')} تومان`)
    expect(referredStatus.text()).not.toContain('٪')
  })

  it('shows a reversed reward and a still-pending (not yet granted) side distinctly', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { items: [{ ...referral, id: 'ref-partial', status: 'partially_granted' }], total: 1, page: 1, pageSize: 20 },
      error: null,
    })
    const wrapper = mount(ReferralsView)
    await flushPromises()

    fetchMock.mockResolvedValueOnce({
      data: [
        {
          id: 'rr-3',
          beneficiaryRole: 'referrer',
          beneficiaryUserId: 'u-referrer',
          rewardKind: 'wallet_credit',
          rewardValue: 50000,
          status: 'reversed',
          grantedAt: '2026-07-20T10:00:00.000Z',
          reversedAt: '2026-07-21T10:00:00.000Z',
          reversalReason: 'رزرو منجر به بازپرداخت شد',
          reversalShortfallAmount: null,
          walletTransactionId: 'wtx-2',
          couponId: null,
          couponCode: null,
          couponIsActive: null,
        },
      ],
      error: null,
    })

    await wrapper.get('summary').trigger('click')
    await flushPromises()

    const referrerStatus = wrapper.get('[data-testid="reward-status-referrer"]')
    expect(referrerStatus.text()).toContain('برگشت خورد')
    expect(referrerStatus.text()).toContain('رزرو منجر به بازپرداخت شد')

    // The referred side has no referral_rewards row at all yet -- rendered as "not
    // granted yet", not fabricated as reversed/pending.
    expect(wrapper.find('[data-testid="reward-status-referred"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="referral-details"]').text()).toContain('هنوز اعطا نشده')
  })
})
