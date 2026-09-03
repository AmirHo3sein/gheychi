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

  // Queues the response to the entitlements read (GET /salons/mine/subscription) the
  // component fires in onMounted -- must be registered before mount(), since it's the very
  // first apiFetch call the component makes. Defaults to an empty bag, which resolves to
  // "granted" for both customHandle/qrCode (the registry's own defaultValue: true), matching
  // every pre-existing test's assumption that both are visible unless a test opts out.
  async function mountCard(entitlements: Record<string, unknown> = {}) {
    fetchMock.mockResolvedValueOnce({ data: { resolvedEntitlements: entitlements }, error: null })
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

  it('rejects an invalid handle client-side without calling the handle API', async () => {
    const wrapper = await mountCard()
    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('Not Valid!')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalledWith('/salons/mine/handle', expect.anything())
    expect(wrapper.text()).toContain('آدرس فقط می‌تواند شامل حروف انگلیسی کوچک')
  })

  it('saves a valid handle and refreshes the shared salon state', async () => {
    const wrapper = await mountCard()
    fetchMock.mockResolvedValueOnce({ data: null, error: null }) // PATCH /salons/mine/handle
    fetchMock.mockResolvedValueOnce({ data: { ...SALON, slug: 'my-new-handle' }, error: null }) // refetch

    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('my-new-handle')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/salons/mine/handle', {
      method: 'PATCH',
      body: { handle: 'my-new-handle' },
    })
    expect(useSalon().salon.value?.slug).toBe('my-new-handle')
    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(false)
    expect(pushToastMock).toHaveBeenCalled()
  })

  it('leaves the edit form open (does not silently drop the attempt) when the API rejects the handle', async () => {
    const wrapper = await mountCard()
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'قبلا استفاده شده' } })

    await wrapper.get('[data-testid="edit-handle-button"]').trigger('click')
    await wrapper.get('[data-testid="handle-input"]').setValue('taken-handle')
    await wrapper.get('[data-testid="save-handle-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="handle-input"]').exists()).toBe(true)
    expect(useSalon().salon.value?.slug).toBe('test-salon')
  })

  // Read-only UI gating off GET /salons/mine/subscription's resolvedEntitlements -- the real
  // enforcement for handle changes is server-side (SalonsService.updateHandle); QR has no
  // backend call to gate at all, so this IS the actual control for it.
  describe('entitlement-gated UI', () => {
    it('hides the edit-handle button and shows an upgrade note when customHandle is denied', async () => {
      const wrapper = await mountCard({ customHandle: false })

      expect(wrapper.find('[data-testid="edit-handle-button"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="handle-locked-note"]').text()).toContain('ویرایش نشانی اختصاصی')
    })

    it('hides the QR download button and image, showing an upgrade note instead, when qrCode is denied', async () => {
      const wrapper = await mountCard({ qrCode: false })

      expect(wrapper.find('[data-testid="qr-image"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="download-qr-button"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="qr-locked-note"]').text()).toContain('کد QR')
    })

    it('shows both when the entitlements bag omits the keys -- absent means granted, matching the registry default', async () => {
      const wrapper = await mountCard({})

      expect(wrapper.find('[data-testid="edit-handle-button"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="qr-image"]').exists()).toBe(true)
    })
  })
})
