import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// Only `useRoute` is needed here -- the links themselves are RouterLinkStubs, so a full
// router instance would be ceremony with no extra coverage.
const currentPath = ref('/')
vi.mock('vue-router', () => ({ useRoute: () => ({ path: currentPath.value }) }))

const { default: SidebarNav } = await import('./SidebarNav.vue')

function mountNav(path: string) {
  currentPath.value = path
  return mount(SidebarNav, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('SidebarNav', () => {
  it('marks only the dashboard active on /', () => {
    const wrapper = mountNav('/')
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/')
  })

  it('keeps the salons link active on a salon detail route', () => {
    const wrapper = mountNav('/salons/abc-123')
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/salons')
  })

  it('does not double-highlight /referrals when on the sibling settings route', () => {
    const wrapper = mountNav('/referrals/settings')
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/referrals/settings')
  })

  // Below `md` the sidebar collapses to an icon-only rail (a 16rem sidebar leaves 64px of
  // page on a 320px screen). The visible label is hidden there, so every link has to carry
  // its name in an attribute or the whole nav becomes a column of anonymous glyphs.
  it('names every link independently of its visible label, for the collapsed rail', () => {
    const wrapper = mountNav('/')
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      const label = link.text().trim()
      expect(link.attributes('aria-label')).toBe(label)
      expect(link.attributes('title')).toBe(label)
    }
  })

  it('keeps every rail target at least 44px tall while collapsed', () => {
    const wrapper = mountNav('/')
    for (const link of wrapper.findAllComponents(RouterLinkStub)) {
      expect(link.classes()).toContain('min-h-11')
      // ...and gives that back to the denser desktop rhythm once the labels are visible.
      expect(link.classes()).toContain('md:min-h-0')
    }
  })
})
