import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { SECTION_LINKS } from '@/utils/section-links'
import MoreView from './MoreView.vue'

describe('MoreView', () => {
  it('lists every secondary section as a link, grouped under headings', () => {
    const wrapper = mount(MoreView, {
      global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })

    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(expect.arrayContaining(SECTION_LINKS.map((l) => l.to)))
    expect(hrefs).toHaveLength(SECTION_LINKS.length)
    for (const to of ['/customers', '/hours', '/settings', '/photos', '/stories', '/portfolio', '/packages', '/coupons', '/team', '/plan']) {
      expect(hrefs).toContain(to)
    }
    expect(wrapper.findAll('h2')).toHaveLength(3)
  })
})
