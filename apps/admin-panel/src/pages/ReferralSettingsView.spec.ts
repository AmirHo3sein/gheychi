import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReferralSettingsView from './ReferralSettingsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// Exactly the R12/Product-Decision-1 default: all three rows enabled=false, zero-value
// rewards, seeded by the migration -- returned in referral_type's alphabetical PK order
// (salon_owner, user, worker), same as `ORDER BY referral_type ASC` server-side.
const REWARD_TYPES = [
  {
    referralType: 'salon_owner',
    enabled: false,
    referrerRewardKind: 'wallet_credit',
    referrerRewardValue: 0,
    referrerRewardMax: null,
    referredRewardKind: 'percent_discount',
    referredRewardValue: 0,
    referredRewardMax: null,
    qualifyingEvent: 'first_paid_booking',
    grantHoldbackHours: 72,
    expirationDays: null,
    maxReferralsPerReferrer: null,
    updatedAt: '2026-07-21T00:00:00.000Z',
  },
  {
    referralType: 'user',
    enabled: false,
    referrerRewardKind: 'wallet_credit',
    referrerRewardValue: 0,
    referrerRewardMax: null,
    referredRewardKind: 'percent_discount',
    referredRewardValue: 0,
    referredRewardMax: null,
    qualifyingEvent: 'first_paid_booking',
    grantHoldbackHours: 72,
    expirationDays: null,
    maxReferralsPerReferrer: null,
    updatedAt: '2026-07-21T00:00:00.000Z',
  },
  {
    referralType: 'worker',
    enabled: false,
    referrerRewardKind: 'wallet_credit',
    referrerRewardValue: 0,
    referrerRewardMax: null,
    referredRewardKind: 'percent_discount',
    referredRewardValue: 0,
    referredRewardMax: null,
    qualifyingEvent: 'first_paid_booking',
    grantHoldbackHours: 72,
    expirationDays: null,
    maxReferralsPerReferrer: null,
    updatedAt: '2026-07-21T00:00:00.000Z',
  },
]

async function mountView() {
  fetchMock.mockResolvedValueOnce({ data: REWARD_TYPES.map((r) => ({ ...r })), error: null })
  const wrapper = mount(ReferralSettingsView)
  await flushPromises()
  return wrapper
}

describe('ReferralSettingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads all three rows in User / Salon Owner / Worker order, each showing the disabled banner by default', async () => {
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/admin/referral-reward-types', { silent: true })
    const text = wrapper.text()
    const userIdx = text.indexOf('کاربر عادی')
    const ownerIdx = text.indexOf('صاحب سالن')
    const workerIdx = text.indexOf('کارمند')
    expect(userIdx).toBeGreaterThan(-1)
    expect(userIdx).toBeLessThan(ownerIdx)
    expect(ownerIdx).toBeLessThan(workerIdx)

    // R12 default state reads as intentional, not broken: three disabled badges + banners.
    expect(wrapper.findAll('[data-testid="disabled-banner"]')).toHaveLength(3)
    expect(text).toContain('غیرفعال')
  })

  it('toggling the switch for one type flips only that type\'s badge locally', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="enabled-toggle-worker"]').trigger('click')

    // Still 2 disabled banners (user, salon_owner) -- worker's disappeared once toggled on.
    expect(wrapper.findAll('[data-testid="disabled-banner"]')).toHaveLength(2)
  })

  it('saves a row with the full field set, PATCHing only that referral type', async () => {
    const wrapper = await mountView()
    fetchMock.mockResolvedValueOnce({
      data: { ...REWARD_TYPES[1], enabled: true, referrerRewardValue: 20000, referredRewardValue: 15 },
      error: null,
    })

    await wrapper.get('[data-testid="enabled-toggle-user"]').trigger('click')
    await wrapper.get('[data-testid="referrer-value-user"]').setValue(20000)
    await wrapper.get('[data-testid="referred-value-user"]').setValue(15)
    await wrapper.get('[data-testid="save-user"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/referral-reward-types/user', {
      method: 'PATCH',
      body: {
        enabled: true,
        referrerRewardKind: 'wallet_credit',
        referrerRewardValue: 20000,
        referrerRewardMax: null,
        referredRewardKind: 'percent_discount',
        referredRewardValue: 15,
        referredRewardMax: null,
        qualifyingEvent: 'first_paid_booking',
        grantHoldbackHours: 72,
        expirationDays: null,
        maxReferralsPerReferrer: null,
      },
    })
    // Only the 'user' row's disabled banner is gone -- the other two rows are untouched.
    expect(wrapper.findAll('[data-testid="disabled-banner"]')).toHaveLength(2)
  })

  it('sends null (not 0/NaN) for the nullable cap fields left empty', async () => {
    const wrapper = await mountView()
    fetchMock.mockResolvedValueOnce({ data: { ...REWARD_TYPES[2] }, error: null })

    await wrapper.get('[data-testid="save-worker"]').trigger('click')
    await flushPromises()

    const call = fetchMock.mock.calls.find(([url]) => url === '/admin/referral-reward-types/worker')
    expect(call?.[1]).toMatchObject({
      body: expect.objectContaining({ maxReferralsPerReferrer: null, expirationDays: null, referrerRewardMax: null, referredRewardMax: null }),
    })
  })
})
