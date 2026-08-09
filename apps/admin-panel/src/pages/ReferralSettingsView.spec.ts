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

  it('save button is disabled with no changes, and clicking it opens a per-row confirm summary before PATCHing', async () => {
    const wrapper = await mountView()

    // Nothing edited yet -- save is disabled, and there is no confirm screen.
    expect(wrapper.get('[data-testid="save-user"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="confirm-summary-user"]').exists()).toBe(false)

    fetchMock.mockResolvedValueOnce({
      data: { ...REWARD_TYPES[1], enabled: true, referrerRewardValue: 20000, referredRewardValue: 15 },
      error: null,
    })

    await wrapper.get('[data-testid="enabled-toggle-user"]').trigger('click')
    await wrapper.get('[data-testid="referrer-value-user"]').setValue(20000)
    await wrapper.get('[data-testid="referred-value-user"]').setValue(15)
    await wrapper.get('[data-testid="save-user"]').trigger('click')

    // Only the GET has happened -- the confirm screen is showing, not yet PATCHed.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const summary = wrapper.get('[data-testid="confirm-summary-user"]')
    // referrerRewardValue's kind is toman-denominated -- Farsi-digit, fa-IR-grouped
    // (formatToman), matching referredRewardValue's percent kind.
    expect(summary.text()).toContain('۲۰٬۰۰۰')
    expect(summary.text()).toContain('15')
    // Only the 'user' card shows a confirm summary -- the other two rows are untouched.
    expect(wrapper.find('[data-testid="confirm-summary-salon_owner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="confirm-summary-worker"]').exists()).toBe(false)

    await wrapper.get('[data-testid="confirm-submit-user"]').trigger('click')
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
    // Confirm screen closed and the 'user' row's disabled banner is gone -- the other two rows
    // are untouched.
    expect(wrapper.find('[data-testid="confirm-summary-user"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="disabled-banner"]')).toHaveLength(2)
  })

  it('cancelling the confirm screen does not fire the PATCH and preserves the in-progress edit', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="referrer-value-worker"]').setValue(500)
    await wrapper.get('[data-testid="save-worker"]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-summary-worker"]').exists()).toBe(true)

    await wrapper.get('[data-testid="confirm-cancel-worker"]').trigger('click')

    expect(wrapper.find('[data-testid="confirm-summary-worker"]').exists()).toBe(false)
    // Only the initial GET happened -- no PATCH was ever sent.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/admin/referral-reward-types/worker'), expect.anything())
    // The edited value survives the cancel.
    expect((wrapper.get('[data-testid="referrer-value-worker"]').element as HTMLInputElement).value).toBe('۵۰۰')
  })

  it('sends null (not 0/NaN) for the nullable cap fields left empty', async () => {
    const wrapper = await mountView()
    fetchMock.mockResolvedValueOnce({ data: { ...REWARD_TYPES[2] }, error: null })

    await wrapper.get('[data-testid="enabled-toggle-worker"]').trigger('click')
    await wrapper.get('[data-testid="save-worker"]').trigger('click')
    await wrapper.get('[data-testid="confirm-submit-worker"]').trigger('click')
    await flushPromises()

    const call = fetchMock.mock.calls.find(([url]) => url === '/admin/referral-reward-types/worker')
    expect(call?.[1]).toMatchObject({
      body: expect.objectContaining({ maxReferralsPerReferrer: null, expirationDays: null, referrerRewardMax: null, referredRewardMax: null }),
    })
  })

  it('surfaces each row\'s updatedAt, falling back to a dash rather than rendering "Invalid Date"', async () => {
    const wrapper = await mountView()

    // fa-IR + Asia/Tehran, matching the rest of the panel's date rendering -- the seeded
    // 2026-07-21T00:00 UTC lands on 1405/04/30 in Tehran (+03:30), rendered with Persian digits.
    expect(wrapper.text()).toContain('آخرین بروزرسانی')
    expect(wrapper.text()).toContain('۱۴۰۵')

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce({
      data: REWARD_TYPES.map((r) => ({ ...r, updatedAt: 'not-a-date' })),
      error: null,
    })
    const broken = mount(ReferralSettingsView)
    await flushPromises()

    expect(broken.text()).not.toContain('Invalid Date')
    expect(broken.text()).toContain('—')
  })

  it('shows a distinct error state (this screen has no empty state of its own) when the fetch fails, and retry reloads', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Something went wrong' } })
    const wrapper = mount(ReferralSettingsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('کاربر عادی')

    fetchMock.mockResolvedValueOnce({ data: REWARD_TYPES.map((r) => ({ ...r })), error: null })
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('کاربر عادی')
  })
})
