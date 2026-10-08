import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import CreatePage from '../../app/pages/beauty-guide/index.vue'
import { FEATURE_FLAGS_STATE_KEY } from '../../app/composables/useFeatureFlags'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })

let routeQuery: Record<string, string> = {}
mockNuxtImport('useRoute', () => () => ({ params: {}, query: routeQuery }))
const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const PORTFOLIO_ID = '0b6c1e57-2f0a-4c1e-9b1e-1d2c3e4f5a6b'

function setFlag(on: boolean) {
  const flags = useState<Record<string, boolean>>(FEATURE_FLAGS_STATE_KEY)
  flags.value = { ...(flags.value ?? {}), beautyGuideEnabled: on }
}

async function choose(wrapper: Awaited<ReturnType<typeof mountSuspended>>, file: File) {
  const input = wrapper.get('[data-testid="guide-file-input"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
}

describe('beauty guide create page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    routeQuery = {}
    vi.stubGlobal('$fetch', fetchStub)
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }))
    setFlag(true)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows an unavailable state (and no upload) when the feature is off', async () => {
    setFlag(false)
    const wrapper = await mountSuspended(CreatePage)
    expect(wrapper.find('[data-testid="guide-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="guide-file-input"]').exists()).toBe(false)
  })

  it('rejects unsupported files client-side before uploading', async () => {
    const wrapper = await mountSuspended(CreatePage)
    await choose(wrapper, new File(['gif'], 'a.gif', { type: 'image/gif' }))
    expect(wrapper.get('[data-testid="guide-file-error"]').text()).toContain('JPEG')
    expect(wrapper.get('[data-testid="guide-submit"]').attributes('disabled')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads as multipart and opens the new guide', async () => {
    fetchMock.mockResolvedValue({ id: 'g1', status: 'ready' })
    const wrapper = await mountSuspended(CreatePage)
    await choose(wrapper, new File(['jpeg'], 'look.jpg', { type: 'image/jpeg' }))
    expect(wrapper.find('[data-testid="guide-preview"]').exists()).toBe(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const [path, options] = fetchMock.mock.calls[0]!
    expect(path).toBe('/beauty-guides')
    expect(options.method).toBe('POST')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('file')).toBeInstanceOf(File)
    expect(navigateToMock).toHaveBeenCalledWith('/beauty-guide/g1')
  })

  it('shows the API’s daily-limit message on 429', async () => {
    fetchMock.mockRejectedValue({ response: { status: 429 }, data: { message: 'سقف ساخت راهنمای زیبایی برای امروز پر شده است', code: 'BEAUTY_GUIDE_DAILY_LIMIT' } })
    const wrapper = await mountSuspended(CreatePage)
    await choose(wrapper, new File(['jpeg'], 'look.jpg', { type: 'image/jpeg' }))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-submit-error"]').text()).toContain('سقف ساخت راهنمای زیبایی')
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('starts "explain this look" from a portfolio item through the same engine', async () => {
    routeQuery = { portfolioItemId: PORTFOLIO_ID }
    fetchMock.mockResolvedValue({ id: 'g2', status: 'ready' })
    await mountSuspended(CreatePage)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith(`/beauty-guides/from-portfolio/${PORTFOLIO_ID}`, expect.objectContaining({ method: 'POST' }))
    expect(navigateToMock).toHaveBeenCalledWith('/beauty-guide/g2')
  })

  it('ignores a malformed portfolioItemId', async () => {
    routeQuery = { portfolioItemId: '../../x' }
    await mountSuspended(CreatePage)
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
