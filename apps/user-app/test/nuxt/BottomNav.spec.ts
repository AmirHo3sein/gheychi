import { describe, it, expect, beforeEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import BottomNav from '../../app/components/layout/BottomNav.vue'
import { useSessionStore } from '../../app/stores/session'
import { FEATURE_FLAGS_STATE_KEY } from '../../app/composables/useFeatureFlags'

let routePath = '/'
mockNuxtImport('useRoute', () => () => ({ path: routePath, params: {}, query: {} }))

const USER = { id: 'u1', phone: '09120000000', name: 'Test', gender: 'female' as const, role: 'customer' as const }

function setBeautyGuide(on: boolean) {
  const flags = useState<Record<string, boolean>>(FEATURE_FLAGS_STATE_KEY)
  flags.value = { ...(flags.value ?? {}), beautyGuideEnabled: on }
}

const labels = (wrapper: Awaited<ReturnType<typeof mountSuspended>>) => wrapper.findAll('li a').map((a: { text: () => string }) => a.text())

describe('BottomNav', () => {
  beforeEach(() => {
    useSessionStore().$reset()
    routePath = '/'
    setBeautyGuide(false)
  })

  it('gives a logged-out visitor discovery tabs plus sign-in (no account tabs)', async () => {
    const wrapper = await mountSuspended(BottomNav)
    expect(labels(wrapper)).toEqual(['خانه', 'سالن‌ها', 'بلاگ', 'ورود'])
    expect(wrapper.find('a[href="/login"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/bookings"]').exists()).toBe(false)
  })

  it('gives a customer home, salons, bookings and profile', async () => {
    useSessionStore().setUser(USER)
    const wrapper = await mountSuspended(BottomNav)
    expect(labels(wrapper)).toEqual(['خانه', 'سالن‌ها', 'نوبت‌ها', 'پروفایل'])
  })

  it('adds the Beauty Guide tab only while the feature flag is on', async () => {
    useSessionStore().setUser(USER)
    setBeautyGuide(true)
    const wrapper = await mountSuspended(BottomNav)
    expect(labels(wrapper)).toEqual(['خانه', 'سالن‌ها', 'راهنما', 'نوبت‌ها', 'پروفایل'])
    expect(wrapper.find('a[href="/beauty-guide"]').exists()).toBe(true)
  })

  it('marks exactly the current section with aria-current (nested routes count)', async () => {
    useSessionStore().setUser(USER)
    routePath = '/bookings/abc'
    const wrapper = await mountSuspended(BottomNav)
    const current = wrapper.findAll('a[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]!.attributes('href')).toBe('/bookings')
  })

  it('treats the account sub-pages as the profile tab', async () => {
    useSessionStore().setUser(USER)
    routePath = '/account/wallet'
    const wrapper = await mountSuspended(BottomNav)
    expect(wrapper.get('a[aria-current="page"]').attributes('href')).toBe('/profile')
  })

  it('is a phone-only bar (hidden from md up) and labelled as navigation', async () => {
    const wrapper = await mountSuspended(BottomNav)
    const nav = wrapper.get('nav')
    expect(nav.classes()).toContain('md:hidden')
    expect(nav.attributes('aria-label')).toBe('ناوبری سریع')
  })
})
