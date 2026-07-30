import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import IndexPage from '../../app/pages/index.vue'
import { useSessionStore } from '../../app/stores/session'

// Same pattern as profile.spec.ts / login.spec.ts: `$fetch` is a real globalThis binding,
// not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const USER = { id: 'u1', phone: '09120000000', name: 'Test', gender: 'female' as const, role: 'customer' as const }

function stub() {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/categories') return []
    if (path === '/search') return []
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('home page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    useSessionStore().$reset()
    useSessionStore().setUser(USER)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('searches with the salon-target gender mapped from the user own gender', async () => {
    stub()
    await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/search', expect.objectContaining({ query: expect.objectContaining({ gender: 'women' }) }))
  })

  it('asks an account with no gender to complete its profile instead of firing a request that can only 400', async () => {
    // /search's `gender` param is required, so with gender = null ofetch drops the param and
    // the API 400s -- which used to render the generic "something went wrong" card whose
    // retry button re-issued the very same invalid request, forever.
    useSessionStore().setUser({ ...USER, gender: null })
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalledWith('/search', expect.anything())
    const prompt = wrapper.find('[data-testid="needs-profile"]')
    expect(prompt.exists()).toBe(true)
    expect(prompt.find('a').attributes('href')).toBe('/profile')
    // Specifically NOT the retry-forever error card.
    expect(wrapper.text()).not.toContain('مشکلی در بارگذاری سالن‌ها پیش آمد')
  })
})
