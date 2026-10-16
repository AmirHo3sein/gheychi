import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BottomNav from './BottomNav.vue'
import { NAV_TABS, isTabActive } from './nav-tabs'

const route = { path: '/' }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

function mountNav(path: string, pendingCount = 0) {
  route.path = path
  return mount(BottomNav, {
    props: { pendingCount },
    global: { stubs: { RouterLink: { template: '<a :class="$attrs.class"><slot /></a>' } } },
  })
}

describe('isTabActive', () => {
  it('matches the dashboard only on an exact "/"', () => {
    expect(isTabActive('/', '/')).toBe(true)
    expect(isTabActive('/', '/bookings')).toBe(false)
  })

  it('matches a section on its own path and on nested paths', () => {
    expect(isTabActive('/bookings', '/bookings')).toBe(true)
    expect(isTabActive('/bookings', '/bookings/b1')).toBe(true)
    // Not a prefix match on a sibling route that merely starts with the same string.
    expect(isTabActive('/service', '/services')).toBe(false)
  })
})

describe('BottomNav', () => {
  it('renders every primary destination', () => {
    const wrapper = mountNav('/')

    expect(wrapper.findAll('a')).toHaveLength(NAV_TABS.length)
  })

  // Layout regression, iOS. The bar is `fixed bottom-0`; without the safe-area inset its
  // bottom row (label + active indicator) renders underneath the home indicator.
  it('pads itself for the iOS home-indicator inset', () => {
    expect(mountNav('/').get('nav').classes()).toContain('pb-[env(safe-area-inset-bottom)]')
  })

  // A phone bottom bar spanning a 1280px+ screen is the wrong shape for the desktop/tablet
  // setup session PRODUCT.md treats as equally real -- from lg the grouped sidebar carries
  // every destination instead (AppLayout.vue), so exactly one of the two is ever visible.
  it('hides itself from lg up, where the sidebar carries the same destinations', () => {
    expect(mountNav('/').get('nav').classes()).toContain('lg:hidden')
  })

  // 320px / 5 tabs leaves 64px each; a label must truncate rather than widen the bar.
  it('constrains each tab so a label cannot force the bar wider than the viewport', () => {
    const link = mountNav('/').get('a')

    expect(link.classes()).toContain('min-w-0')
    expect(link.find('span.truncate').exists()).toBe(true)
  })

  // 6 tabs at the 320px minimum phone width must still clear the 44px touch-target floor.
  it('keeps every tab at least 44px wide at 320px', () => {
    expect(NAV_TABS.length).toBe(6)
    expect(320 / NAV_TABS.length).toBeGreaterThanOrEqual(44)
    expect(mountNav('/').get('a').classes()).toContain('min-h-11')
  })

  it('ends with the «بیشتر» tab pointing at /more', () => {
    const last = NAV_TABS[NAV_TABS.length - 1]
    expect(last).toMatchObject({ to: '/more', label: 'بیشتر' })
    expect(isTabActive('/more', '/more')).toBe(true)
  })

  it('marks only the active tab with aria-current="page"', () => {
    const links = mountNav('/bookings').findAll('a')
    const current = links.filter((a) => a.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].text()).toContain('نوبت‌ها')
  })

  // The five key destinations come from the one grouped nav config, in this order.
  it('carries dashboard, bookings, customers, services and earnings before «بیشتر»', () => {
    expect(NAV_TABS.map((t) => t.to)).toEqual(['/', '/bookings', '/customers', '/services', '/earnings', '/more'])
  })

  it('shows the pending-approval count on the bookings tab without changing its accessible name', () => {
    const wrapper = mountNav('/', 3)
    const badge = wrapper.get('[data-testid="bottom-pending-badge"]')
    expect(badge.text()).toBe((3).toLocaleString('fa-IR'))
    expect(badge.attributes('aria-hidden')).toBe('true')
    const bookings = wrapper.findAll('a').find((a) => a.text().includes('نوبت‌ها'))!
    expect(bookings.attributes('aria-describedby')).toBe('bottom-pending-desc')
    expect(wrapper.get('#bottom-pending-desc').text()).toContain('درخواست در انتظار تأیید')
  })

  it('shows no badge when nothing is pending', () => {
    const wrapper = mountNav('/', 0)
    expect(wrapper.find('[data-testid="bottom-pending-badge"]').exists()).toBe(false)
    expect(wrapper.findAll('a[aria-describedby]')).toHaveLength(0)
  })

  // A screen reached through «بیشتر» highlights that tab, but only /more itself is the page.
  it('highlights «بیشتر» on a secondary screen without claiming aria-current', () => {
    const links = mountNav('/team').findAll('a')
    const more = links[links.length - 1]!
    expect(more.classes()).toContain('text-(--color-accent-text)')
    expect(more.attributes('aria-current')).toBeUndefined()
    expect(links.filter((a) => a.attributes('aria-current') === 'page')).toHaveLength(0)
  })
})
