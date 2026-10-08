import { mount, RouterLinkStub } from '@vue/test-utils'
import AppIcon from '@/components/ui/AppIcon.vue'
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
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent-text)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/')
  })

  it('keeps the salons link active on a salon detail route', () => {
    const wrapper = mountNav('/salons/abc-123')
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent-text)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/salons')
  })

  it('does not double-highlight /referrals when on the sibling settings route', () => {
    const wrapper = mountNav('/referrals/settings')
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent-text)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/referrals/settings')
  })

  it('links the beauty-guide concepts page and highlights it there', () => {
    const wrapper = mountNav('/beauty-concepts')
    const link = wrapper.findAllComponents(RouterLinkStub).find((l) => l.props('to') === '/beauty-concepts')
    expect(link?.text()).toBe('مفاهیم راهنمای زیبایی')
    const active = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.classes().includes('text-(--color-accent-text)'))
    expect(active).toHaveLength(1)
    expect(active[0]!.props('to')).toBe('/beauty-concepts')
  })

  // The nav used to collapse to an icon-only rail on phones; it is now the same labelled list
  // in the desktop sidebar and the phone drawer, so every link shows its own name.
  it('shows a visible label on every link and marks the current page for assistive tech', () => {
    const wrapper = mountNav('/salons')
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link.text().trim()).not.toBe('')
    const current = links.filter((l) => l.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]!.props('to')).toBe('/salons')
  })

  it('groups the links under labelled sections in the agreed order', () => {
    const wrapper = mountNav('/')
    const groups = wrapper.findAll('[data-testid="nav-group"]')
    expect(groups.map((g) => g.find('p').text())).toEqual([
      'نمای کلی',
      'سالن‌ها و نوبت‌ها',
      'نظارت',
      'کاتالوگ',
      'مالی',
      'سیستم',
    ])
    const routesOf = (i: number) =>
      wrapper
        .findAllComponents(RouterLinkStub)
        .filter((l) => groups[i]!.element.contains(l.element))
        .map((l) => l.props('to'))
    expect(routesOf(0)).toEqual(['/', '/analytics'])
    expect(routesOf(1)).toEqual(['/salons', '/featured', '/bookings'])
    expect(routesOf(2)).toEqual(['/reviews', '/worker-ratings', '/reports', '/category-requests'])
    expect(routesOf(3)).toEqual(['/categories', '/beauty-concepts', '/blog'])
    expect(routesOf(4)).toEqual([
      '/coupons', '/plans', '/subscription-coupons', '/wallet', '/invoices', '/referrals', '/referrals/settings',
    ])
    expect(routesOf(5)).toEqual(['/users', '/audit-log', '/config', '/feature-flags'])
  })

  it('links all 23 destinations exactly once, each with its own icon', () => {
    const wrapper = mountNav('/')
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links).toHaveLength(23)
    expect(new Set(links.map((l) => l.props('to'))).size).toBe(23)
    const icons = links.map((l) => l.findComponent(AppIcon).props('name'))
    expect(new Set(icons).size).toBe(23)
  })

  it('names the platform pages exactly as their page titles do', () => {
    const wrapper = mountNav('/')
    const label = (to: string) => wrapper.findAllComponents(RouterLinkStub).find((l) => l.props('to') === to)?.text()
    expect(label('/config')).toBe('تنظیمات پلتفرم')
    expect(label('/feature-flags')).toBe('ویژگی‌های پلتفرم')
  })

  it('keeps every target at least 44px tall on phones', () => {
    const wrapper = mountNav('/')
    for (const link of wrapper.findAllComponents(RouterLinkStub)) expect(link.classes()).toContain('min-h-11')
  })

  it('emits navigate when a link is clicked, so the phone drawer can close', async () => {
    const wrapper = mountNav('/')
    await wrapper.findAllComponents(RouterLinkStub)[0]!.trigger('click')
    expect(wrapper.emitted('navigate')).toHaveLength(1)
  })
})
