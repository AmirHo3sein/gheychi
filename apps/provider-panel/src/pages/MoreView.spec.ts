import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { MORE_GROUPS, NAV_ITEMS } from '@/components/layout/nav-config'
import { NAV_TABS } from '@/components/layout/nav-tabs'
import MoreView from './MoreView.vue'

function mountMore() {
  return mount(MoreView, {
    global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
}

describe('MoreView', () => {
  it('lists every screen the bottom bar does not carry, grouped under headings', () => {
    const wrapper = mountMore()

    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    const expected = NAV_ITEMS.filter((i) => !i.bottom).map((i) => i.to)
    expect(hrefs).toEqual(expected)
    for (const to of ['/hours', '/settings', '/photos', '/stories', '/portfolio', '/packages', '/coupons', '/team', '/plan', '/reviews', '/referral']) {
      expect(hrefs).toContain(to)
    }
    expect(wrapper.findAll('h2')).toHaveLength(MORE_GROUPS.length)
  })

  // Every destination of the panel must be reachable on a phone: either a bottom-bar tab or
  // a row here. A screen added to the nav config can't silently fall through the gap.
  it('together with the bottom bar, covers every nav destination', () => {
    const hrefs = mountMore().findAll('a').map((a) => a.attributes('href'))
    const reachable = new Set([...hrefs, ...NAV_TABS.map((t) => t.to)])
    for (const item of NAV_ITEMS) expect(reachable.has(item.to)).toBe(true)
  })

  // The referral/wallet screen has a labelled entry on phones, not only an icon.
  it('gives the referral/wallet screen a labelled row', () => {
    const wrapper = mountMore()
    expect(wrapper.get('[data-testid="more-link-referral"]').text()).toContain('معرفی و کیف پول')
  })
})
