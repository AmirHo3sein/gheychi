import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PublicLinkCard from './PublicLinkCard.vue'
import { resetSalon, useSalon } from '@/composables/useSalon'

const fetchMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ push: pushToastMock, toasts: [] }),
}))
// jsdom's <canvas> has no real 2D rendering backend (that requires the native `canvas`
// npm package, which this repo deliberately doesn't add just for tests) -- QRCode.toDataURL
// would silently fail in this environment regardless of the component's own logic, so the
// library itself is mocked rather than exercised for real.
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}))

const SALON = {
  id: 's1', name: 'سالن تست', slug: 'test-salon', status: 'approved' as const,
  genderTarget: 'women' as const, address: 'x', city: 'تهران', capacity: 1, rejectionReason: null,
}

describe('PublicLinkCard', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    pushToastMock.mockReset()
    resetSalon()
    useSalon().salon.value = { ...SALON }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function mountCard() {
    const wrapper = mount(PublicLinkCard)
    await flushPromises()
    return wrapper
  }

  it('renders the public URL built from the salon slug', async () => {
    const wrapper = await mountCard()
    expect(wrapper.get('[data-testid="public-url"]').text()).toContain('/salons/test-salon')
  })

  it('renders a QR code image once the async generation resolves', async () => {
    const wrapper = await mountCard()
    const img = wrapper.get('[data-testid="qr-image"]')
    expect(img.attributes('src')).toBe('data:image/png;base64,FAKE')
  })

  it('copies the plain link (no ?source=qr) to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const wrapper = await mountCard()
    await wrapper.get('[data-testid="copy-link-button"]').trigger('click')

    expect(writeText).toHaveBeenCalledWith('http://localhost:3003/salons/test-salon')
    await flushPromises()
    expect(wrapper.get('[data-testid="copy-link-button"]').text()).toBe('کپی شد')
  })

  it('rejects an invalid handle client-side without calling the API', async () => {
    const wrapper = await mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('Not Valid!')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('آدرس فقط می‌تواند شامل حروف انگلیسی کوچک')
  })

  it('saves a valid handle and refreshes the shared salon state', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: null }) // PATCH /salons/mine/handle
    fetchMock.mockResolvedValueOnce({ data: { ...SALON, slug: 'my-new-handle' }, error: null }) // refetch

    const wrapper = await mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('my-new-handle')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/salons/mine/handle', {
      method: 'PATCH',
      body: { handle: 'my-new-handle' },
    })
    expect(useSalon().salon.value?.slug).toBe('my-new-handle')
    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(false)
    expect(pushToastMock).toHaveBeenCalled()
  })

  it('leaves the edit form open (does not silently drop the attempt) when the API rejects the handle', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'قبلا استفاده شده' } })

    const wrapper = await mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('taken-handle')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(true)
    expect(useSalon().salon.value?.slug).toBe('test-salon')
  })
})
