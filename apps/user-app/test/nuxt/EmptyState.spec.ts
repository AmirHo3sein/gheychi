import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import EmptyState from '../../app/components/ui/EmptyState.vue'

describe('EmptyState', () => {
  it('renders the title, the description and the requested mascot pose as a decorative image', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { pose: 'calendar', title: 'نوبتی ثبت نشده است', description: 'اولین نوبتت را رزرو کن.' },
    })
    expect(wrapper.get('[data-testid="empty-state-title"]').text()).toBe('نوبتی ثبت نشده است')
    expect(wrapper.text()).toContain('اولین نوبتت را رزرو کن.')
    const img = wrapper.get('[data-testid="empty-state-mascot"] img')
    expect(img.attributes('src')).toBe('/mascot/calendar.webp')
    // The title carries the meaning; the mascot must not be announced as content.
    expect(img.attributes('alt')).toBe('')
  })

  // The pose tiles are cut on #FBF6F2 and are ~210px natively: the container must carry the
  // matching tile colour (so the edge disappears) and they must never be drawn above 112px.
  it('seats the pose on the mascot-tile colour and never draws it above 112px', async () => {
    const full = await mountSuspended(EmptyState, { props: { title: 't' } })
    const tile = full.get('[data-testid="empty-state-mascot"]')
    expect(tile.classes()).toContain('bg-(--color-mascot-tile)')
    expect(tile.attributes('style')).toContain('width: 112px')

    const compact = await mountSuspended(EmptyState, { props: { title: 't', compact: true } })
    expect(compact.get('[data-testid="empty-state-mascot"]').attributes('style')).toContain('width: 72px')
  })

  it('defaults to the happy pose and omits the description when none is given', async () => {
    const wrapper = await mountSuspended(EmptyState, { props: { title: 'خالی' } })
    expect(wrapper.get('img').attributes('src')).toBe('/mascot/happy.webp')
    expect(wrapper.findAll('p')).toHaveLength(1)
  })

  it('renders a next-step link only when both a destination and a label are given', async () => {
    const withAction = await mountSuspended(EmptyState, { props: { title: 't', actionTo: '/salons', actionLabel: 'مرور سالن‌ها' } })
    const action = withAction.get('[data-testid="empty-state-action"]')
    expect(action.attributes('href')).toBe('/salons')
    expect(action.text()).toBe('مرور سالن‌ها')

    const labelOnly = await mountSuspended(EmptyState, { props: { title: 't', actionLabel: 'x' } })
    expect(labelOnly.find('[data-testid="empty-state-action"]').exists()).toBe(false)
  })

  it('renders slot content and passes caller attributes (test ids) to its root', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't' },
      attrs: { 'data-testid': 'bookings-empty' },
      slots: { default: () => 'دکمه' },
    })
    expect(wrapper.attributes('data-testid')).toBe('bookings-empty')
    expect(wrapper.text()).toContain('دکمه')
  })
})
