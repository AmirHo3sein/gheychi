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
    expect(wrapper.text()).toContain('۴٫۸')
    expect(wrapper.text()).toContain('(۱۲)')
  })

  // Intentional behaviour change (wave 2): «بدون امتیاز» read as a verdict on the person, so
  // a worker with no ratings now has no rating line at all.
  it('shows no rating line (and no «بدون امتیاز») for a worker with zero ratings', async () => {
    const wrapper = await mountSuspended(SalonTeam, { props: { workers } })
    expect(wrapper.text()).not.toContain('بدون امتیاز')
    const second = wrapper.findAll('[data-testid="salon-team-member"]')[1]!
    expect(second.text()).toBe('نگار احمدی')
  })

  it('labels an owner-typed placeholder name («عضو ۱») as «متخصص سالن»', async () => {
    const wrapper = await mountSuspended(SalonTeam, {
      props: { workers: [{ id: 'w9', name: 'عضو ۱', ratingAvg: '0.00', ratingCount: 0 }] },
    })
    expect(wrapper.get('[data-testid="salon-team-member-name"]').text()).toBe('متخصص سالن')
    expect(wrapper.text()).not.toContain('عضو ۱')
  })
})
