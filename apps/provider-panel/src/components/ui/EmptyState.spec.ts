import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import EmptyState from './EmptyState.vue'

describe('EmptyState', () => {
  it('shows the icon disc and message by default', () => {
    const wrapper = mount(EmptyState, { props: { message: 'هنوز چیزی نیست.' } })
    expect(wrapper.text()).toContain('هنوز چیزی نیست.')
    expect(wrapper.find('[data-testid="empty-state-mascot"]').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  // The pose tiles are cut on --color-mascot-tile, so the container must use exactly it.
  it('swaps in a decorative mascot tile on the mascot background', () => {
    const wrapper = mount(EmptyState, { props: { message: 'x', mascot: 'calendar', title: 'نوبتی نیست' } })
    const tile = wrapper.get('[data-testid="empty-state-mascot"]')
    expect(tile.classes()).toContain('bg-(--color-mascot-tile)')
    expect(tile.attributes('aria-hidden')).toBe('true')
    expect(tile.get('img').attributes('src')).toBe('/mascot/calendar.webp')
    expect(tile.get('img').attributes('alt')).toBe('')
    expect(wrapper.text()).toContain('نوبتی نیست')
  })

  it('renders an action passed through the default slot', () => {
    const wrapper = mount(EmptyState, { props: { message: 'x' }, slots: { default: '<button>افزودن</button>' } })
    expect(wrapper.get('button').text()).toBe('افزودن')
  })
})
