import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SlotPicker from '../../app/components/booking/SlotPicker.vue'

// Same pattern as useApi.spec.ts / auth.global.spec.ts: `useApi` wraps the real
// `$fetch` global rather than being an unimport-tracked auto-import composable of its
// own, so the established way to control its behavior in a test is to stub `$fetch`
// directly (via `vi.stubGlobal`) and let the real `useApi` run on top of it.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

describe('SlotPicker', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to the first date with slots and emits the chosen ISO instant on click', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-10', slots: [] },
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z', '2026-07-11T09:30:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    const buttons = wrapper.findAll('[data-testid="slot-button"]')
    expect(buttons).toHaveLength(2)

    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-07-11T09:00:00.000Z'])
  })

  it('shows an empty state when no day has any slots', async () => {
    fetchMock.mockResolvedValue([{ date: '2026-07-10', slots: [] }])
    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.text()).toContain('نوبت خالی')
  })

  it('switches the displayed slots when a different date chip is clicked', async () => {
    fetchMock.mockResolvedValue([
      { date: '2026-07-11', slots: ['2026-07-11T09:00:00.000Z'] },
      { date: '2026-07-12', slots: ['2026-07-12T10:00:00.000Z', '2026-07-12T10:30:00.000Z'] },
    ])

    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.findAll('[data-testid="slot-button"]')).toHaveLength(1)

    const dateChips = wrapper.findAll('button').filter((b) => !b.attributes('data-testid'))
    await dateChips[1]!.trigger('click')

    const buttons = wrapper.findAll('[data-testid="slot-button"]')
    expect(buttons).toHaveLength(2)
    await buttons[0]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['2026-07-12T10:00:00.000Z'])
  })

  it('shows an error state when the availability request fails', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const wrapper = await mountSuspended(SlotPicker, { props: { salonId: 's1', serviceId: 'sv1' } })
    expect(wrapper.text()).toContain('مشکلی پیش آمد')
  })
})
