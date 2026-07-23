import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonTeam from '../../app/components/salon/SalonTeam.vue'

const workers = [
  { id: 'w1', name: 'سارا محمدی', ratingAvg: '4.80', ratingCount: 12 },
  { id: 'w2', name: 'نگار احمدی', ratingAvg: '0.00', ratingCount: 0 },
]

describe('SalonTeam', () => {
  it('renders nothing when the salon has no workers', async () => {
    const wrapper = await mountSuspended(SalonTeam, { props: { workers: [] } })
    expect(wrapper.find('[data-testid="salon-team"]').exists()).toBe(false)
  })

  it('renders one row per worker with name and rating', async () => {
    const wrapper = await mountSuspended(SalonTeam, { props: { workers } })
    const rows = wrapper.findAll('[data-testid="salon-team-member"]')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('سارا محمدی')
    expect(wrapper.text()).toContain('4.8')
    expect(wrapper.text()).toContain('(12)')
  })

  it('shows a no-rating placeholder for a worker with zero ratings', async () => {
    const wrapper = await mountSuspended(SalonTeam, { props: { workers } })
    expect(wrapper.text()).toContain('بدون امتیاز')
  })
})
