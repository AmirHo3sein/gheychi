import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetConfirm, useConfirm } from '@/composables/useConfirm'
import { reportBookings, resetPendingApprovals } from '@/composables/usePendingApprovals'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { useSessionStore } from '@/stores/session'
import AppLayout from './AppLayout.vue'

const blank = { template: '<div />' }

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: AppLayout,
        children: [
          { path: '', name: 'dashboard', component: blank },
          { path: 'bookings', name: 'bookings', component: blank },
          { path: 'team', name: 'team', component: blank },
        ],
      },
      { path: '/login', name: 'login', component: blank },
      // Any other nav destination resolves to a blank page so RouterLink can build its href.
      { path: '/:rest(.*)*', component: blank },
    ],
  })
}

function approvedSalon() {
  const { salon, checked } = useSalon()
  salon.value = {
    id: 's1',
    name: 'سالن سارا',
    slug: 'sara',
    status: 'approved',
    genderTarget: 'women',
    address: 'x',
    city: 'x',
    capacity: 1,
    rejectionReason: null,
  }
  checked.value = true
  return { salon, checked }
}

describe('AppLayout logout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSalon()
    resetPendingApprovals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // useSalon() is a module-level singleton that the router guard only re-probes while
  // `checked` is false. Leaving the previous owner's salon (and `checked: true`) behind on
  // logout would route the next account to log in on this tab on stale data.
  it('clears the session AND the salon singleton, then navigates to /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => null }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const { salon, checked } = approvedSalon()

    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(AppLayout, { global: { plugins: [router] } })
    expect(wrapper.text()).toContain('سالن سارا')

    await wrapper.get('button[title="خروج"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(useSessionStore().user).toBeNull()
    expect(salon.value).toBeNull()
    expect(checked.value).toBe(false)
    // The pending-approval badge is a singleton too and must not survive into the next session.
    expect(wrapper.find('[data-testid="nav-pending-badge"]').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('gives the icon-only controls an aria-label, marks the current nav link, and hosts the confirm sheet', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(AppLayout, { global: { plugins: [router] } })

    expect(wrapper.get('button[title="خروج"]').attributes('aria-label')).toBe('خروج')
    const theme = wrapper.findAll('header button')[0]!
    expect(theme.attributes('aria-label')).toBe(theme.attributes('title'))
    // Same pattern as the bottom bar: the dashboard link of the sidebar nav is the page.
    expect(wrapper.get('aside nav a[aria-current="page"]').text()).toContain('داشبورد')
    expect(wrapper.findAll('aside nav a:not([aria-current])').length).toBeGreaterThan(0)

    useConfirm().confirm({ title: 'آیا مطمئنید؟' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(true)
    resetConfirm()
  })
})

describe('AppLayout sidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSalon()
    resetPendingApprovals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Mounted through a RouterView host, not as AppLayout itself: AppLayout IS the matched
  // route component here, so mounting it directly would render a second copy inside its own
  // RouterView.
  async function mountAt(path: string) {
    const router = makeRouter()
    await router.push(path)
    await router.isReady()
    return mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  }

  // RTL: inline-start is the right edge. Logical classes, so the sidebar sits on the right and
  // the content reserves its width on that same side.
  it('is a fixed lg+ sidebar on the inline-start (right) edge, with the content beside it', async () => {
    const wrapper = await mountAt('/')
    const aside = wrapper.get('aside')
    expect(aside.classes()).toEqual(expect.arrayContaining(['fixed', 'start-0', 'hidden', 'lg:flex']))
    // The top bar stays at every width (salon name + account controls), beside the sidebar.
    expect(wrapper.get('header').classes()).not.toContain('lg:hidden')
    expect(wrapper.find('.route-outlet').element.parentElement!.className).toContain('lg:ps-68')
  })

  it('opens with a «پرش به محتوای اصلی» skip link pointing at the focusable <main>', async () => {
    const wrapper = await mountAt('/')
    const skip = wrapper.get('[data-testid="skip-to-content"]')
    expect(skip.text()).toBe('پرش به محتوای اصلی')
    expect(skip.attributes('href')).toBe('#main-content')
    // First focusable thing in the shell, hidden until focused.
    expect(skip.element.parentElement!.firstElementChild).toBe(skip.element)
    expect(skip.classes()).toEqual(expect.arrayContaining(['sr-only', 'focus:not-sr-only']))
    const main = wrapper.get('main')
    expect(main.attributes('id')).toBe('main-content')
    expect(main.attributes('tabindex')).toBe('-1')
  })

  it('shows the brand lockup in the sidebar and the salon name with the account controls in the top bar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }))
    approvedSalon()
    const wrapper = await mountAt('/')
    const aside = wrapper.get('aside')
    expect(aside.text()).toContain('قیچی')
    expect(aside.text()).toContain('پنل سالن')
    const header = wrapper.get('header')
    expect(header.get('[data-testid="header-salon-name"]').text()).toBe('سالن سارا')
    expect(header.find('button[title="خروج"]').exists()).toBe(true)
    expect(header.find('button[title="حالت تیره"]').exists()).toBe(true)
    // One set of account controls, not a second copy in the sidebar.
    expect(wrapper.findAll('button[title="خروج"]')).toHaveLength(1)
    expect(aside.findAll('button')).toHaveLength(0)
  })

  it('lists every destination once, grouped, including a labelled referral/wallet link', async () => {
    const wrapper = await mountAt('/')
    const hrefs = wrapper.findAll('aside nav a').map((a) => a.attributes('href'))
    for (const to of ['/', '/bookings', '/customers', '/reviews', '/services', '/packages', '/coupons', '/team', '/hours', '/photos', '/stories', '/portfolio', '/earnings', '/plan', '/referral', '/settings']) {
      expect(hrefs.filter((h) => h === to)).toHaveLength(1)
    }
    expect(wrapper.findAll('aside nav h2').map((h) => h.text())).toEqual([
      'امروز',
      'مشتریان',
      'خدمات و قیمت‌ها',
      'تیم و ساعات',
      'ویترین',
      'درآمد و اشتراک',
      'رشد',
      'تنظیمات',
    ])
    expect(wrapper.get('[data-testid="nav-referral"]').text()).toContain('معرفی و کیف پول')
    // Exactly one: e2e finds it by test id, and a duplicate would be a strict-mode failure.
    expect(wrapper.findAll('[data-testid="nav-referral"]')).toHaveLength(1)
  })

  it('marks the active item with aria-current and the accent-soft treatment', async () => {
    const wrapper = await mountAt('/team')
    const current = wrapper.findAll('aside nav a[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]!.text()).toContain('تیم')
    expect(current[0]!.classes()).toEqual(expect.arrayContaining(['bg-(--color-accent-soft)', 'text-(--color-accent-text)']))
  })

  it('badges the bookings item with the pending count, keeping its accessible name exact', async () => {
    const wrapper = await mountAt('/')
    reportBookings([
      { id: 'b1', status: 'pending_approval' },
      { id: 'b2', status: 'pending_approval' },
      { id: 'b3', status: 'confirmed' },
    ])
    await wrapper.vm.$nextTick()

    const badge = wrapper.get('[data-testid="nav-pending-badge"]')
    expect(badge.text()).toBe((2).toLocaleString('fa-IR'))
    expect(badge.attributes('aria-hidden')).toBe('true')
    const link = wrapper.get('[data-testid="sidebar-link-bookings"]')
    expect(link.attributes('aria-describedby')).toBe('sidebar-pending-desc')
    expect(wrapper.get('[data-testid="bottom-pending-badge"]').text()).toBe((2).toLocaleString('fa-IR'))
  })

  it('polls the bookings list for an approved salon, and not at all for a pending one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'b1', status: 'pending_approval' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const { salon } = approvedSalon()
    salon.value!.status = 'pending'
    await mountAt('/')
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/salons/mine/bookings'))).toBe(false)

    salon.value!.status = 'approved'
    const wrapper = await mountAt('/')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/salons/mine/bookings'))).toBe(true)
    expect(wrapper.get('[data-testid="nav-pending-badge"]').text()).toBe((1).toLocaleString('fa-IR'))
  })
})
