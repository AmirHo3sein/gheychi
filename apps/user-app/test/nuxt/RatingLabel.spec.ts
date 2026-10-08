import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import RatingLabel from '../../app/components/salon/RatingLabel.vue'

describe('RatingLabel', () => {
  // "۰٫۰ (۰)" beside a star reads as a terrible score, not "no ratings yet" -- and a new salon
  // is exactly who that unfairly punishes.
  it('says «جدید» instead of a zero score when there are no reviews', async () => {
    const wrapper = await mountSuspended(RatingLabel, { props: { average: 0, count: 0 } })
    expect(wrapper.get('[data-testid="rating-new"]').text()).toBe('جدید')
    expect(wrapper.text()).not.toMatch(/[0۰]٫[0۰]/)
    expect(wrapper.find('[data-testid="rating-label"]').exists()).toBe(false)
  })

  it('shows the real score and review count in Persian digits otherwise', async () => {
    const wrapper = await mountSuspended(RatingLabel, { props: { average: '4.56', count: 12 } })
    const label = wrapper.get('[data-testid="rating-label"]')
    expect(label.text()).toContain('۴٫۶')
    expect(label.text()).toContain('(۱۲)')
    expect(label.attributes('aria-label')).toContain('۴٫۶')
    expect(wrapper.find('[data-testid="rating-new"]').exists()).toBe(false)
  })
})
