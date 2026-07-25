import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast } from '@/composables/useToast'
import StoriesView from './StoriesView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

function inHours(hours: number) {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

// GET /salons/mine/stories returns ALL unexpired rows including removed ones (the
// owner sees the badge, and removed rows still occupy their cap slot).
const stories = [
  {
    id: 'st1',
    url: 'http://localhost:3002/uploads/salons/s1/stories/a.jpg',
    caption: 'رنگ جدید',
    serviceId: 'svc-1',
    status: 'published',
    createdAt: inHours(-6),
    expiresAt: inHours(18),
  },
  {
    id: 'st2',
    url: 'http://localhost:3002/uploads/salons/s1/stories/b.jpg',
    caption: null,
    serviceId: null,
    status: 'removed',
    createdAt: inHours(-22),
    expiresAt: inHours(2),
  },
]
const services = [{ id: 'svc-1', name: 'کوتاهی مو' }]

async function mountView() {
  const wrapper = mount(StoriesView)
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('StoriesView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    fetchMock.mockImplementation((path: string) => {
      // Clone list responses so component-side mutations never leak back into the
      // shared fixtures across tests.
      if (path === '/salons/mine/stories') return Promise.resolve({ data: structuredClone(stories), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('shows the cap meter counting every unexpired story, removed ones included', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="cap-meter"]').text()).toContain('۲ از ۱۰ استوری فعال')
    wrapper.unmount()
  })

  it('marks a removed story with the admin-takedown badge, and only that one', async () => {
    const wrapper = await mountView()

    const badges = wrapper.findAll('[data-testid="removed-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toBe('توسط مدیر حذف شد')
    wrapper.unmount()
  })

  it('shows the remaining time per story', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('۱۸ ساعت مانده')
    expect(wrapper.text()).toContain('۲ ساعت مانده')
    wrapper.unmount()
  })

  it('deletes a story only after confirmation, then refetches the list', async () => {
    const wrapper = await mountView()

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    await wrapper.findAll('[data-testid="delete-story"]')[0]!.trigger('click')
    expect(fetchMock).not.toHaveBeenCalledWith('/salons/mine/stories/st1', { method: 'DELETE' })

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    await wrapper.findAll('[data-testid="delete-story"]')[0]!.trigger('click')
    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/stories/st1', { method: 'DELETE' })

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('gives every delete button an accessible name', async () => {
    const wrapper = await mountView()

    const deleteButtons = wrapper.findAll('[data-testid="delete-story"]')
    expect(deleteButtons.length).toBeGreaterThan(0)
    for (const button of deleteButtons) {
      expect(button.attributes('aria-label')).toBe('حذف استوری')
    }
    wrapper.unmount()
  })

  it('shows a loading spinner before the first fetch resolves', () => {
    const wrapper = mount(StoriesView)

    expect(wrapper.find('.animate-spin').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('هنوز استوری فعالی ندارید')
    wrapper.unmount()
  })

  it('surfaces a retry affordance when the list fails to load', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/stories') return Promise.resolve({ data: null, error: { status: 500, message: 'boom' } })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="retry-stories"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="removed-badge"]').exists()).toBe(false)

    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/stories') return Promise.resolve({ data: structuredClone(stories), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    await wrapper.get('[data-testid="retry-stories"]').trigger('click')
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="cap-meter"]').text()).toContain('۲ از ۱۰ استوری فعال')
    wrapper.unmount()
  })

  it('gates the uploader and shows the cap message once 10 stories are active', async () => {
    const tenStories = Array.from({ length: 10 }, (_, i) => ({
      id: `st-${i}`,
      url: `http://localhost:3002/uploads/salons/s1/stories/${i}.jpg`,
      caption: null,
      serviceId: null,
      status: 'published',
      createdAt: inHours(-1),
      expiresAt: inHours(23),
    }))
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/stories') return Promise.resolve({ data: structuredClone(tenStories), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="cap-reached"]').text()).toContain('به سقف ۱۰ استوری فعال رسیده‌اید')
    expect(wrapper.text()).not.toContain('افزودن تصویر جدید')
    wrapper.unmount()
  })
})
