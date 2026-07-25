import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from '@/composables/useToast'
import TeamView from './TeamView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const workers = [
  { id: 'w1', name: 'سارا', active: true, ratingAvg: '4.50', ratingCount: 2, createdAt: '2026-07-01T00:00:00.000Z' },
  { id: 'w2', name: 'مریم', active: true, ratingAvg: '0.00', ratingCount: 0, createdAt: '2026-07-02T00:00:00.000Z' },
]

async function mountView() {
  const wrapper = mount(TeamView)
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('TeamView referral code reveal', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return Promise.resolve({ data: structuredClone(workers), error: null })
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('fetches and reveals the referral code only after the button is clicked', async () => {
    const wrapper = await mountView()

    expect(fetchMock).not.toHaveBeenCalledWith('/salons/mine/workers/w1/referral-code', expect.anything())
    expect(wrapper.find('[data-testid="referral-code-panel"]').exists()).toBe(false)

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-ABC123', isActive: true, shareUrl: 'https://example.com/r/REF-ABC123' }, error: null }),
    )
    await wrapper.findAll('[data-testid="toggle-referral-code"]')[0]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/workers/w1/referral-code', { silent: true })
    const panel = wrapper.findAll('[data-testid="referral-code-panel"]')[0]!
    expect(panel.get('[data-testid="referral-code-value"]').text()).toBe('REF-ABC123')

    wrapper.unmount()
  })

  it('toggles the panel closed without refetching, then reopens without refetching either', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-XYZ789', isActive: true, shareUrl: 'https://example.com/r/REF-XYZ789' }, error: null }),
    )

    const toggle = wrapper.findAll('[data-testid="toggle-referral-code"]')[0]!
    await toggle.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(2) // initial list + referral-code fetch

    await toggle.trigger('click') // hide
    expect(wrapper.find('[data-testid="referral-code-panel"]').exists()).toBe(false)

    await toggle.trigger('click') // show again -- no new fetch
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="referral-code-value"]').text()).toBe('REF-XYZ789')

    wrapper.unmount()
  })

  it('shows an inline error when the referral-code lookup fails', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { status: 404, message: 'کارمند یافت نشد.' } }),
    )

    await wrapper.findAll('[data-testid="toggle-referral-code"]')[0]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="referral-code-panel"]').text()).toContain('کارمند یافت نشد.')
    expect(wrapper.find('[data-testid="referral-code-value"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('copies the code to the clipboard and toasts confirmation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-COPY1', isActive: true, shareUrl: 'https://example.com/r/REF-COPY1' }, error: null }),
    )
    await wrapper.findAll('[data-testid="toggle-referral-code"]')[0]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="copy-referral-code"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(writeText).toHaveBeenCalledWith('REF-COPY1')
    expect(useToast().toasts.value.some((t) => t.message === 'کد در کلیپ‌بورد کپی شد.')).toBe(true)

    wrapper.unmount()
  })

  it('fetches each worker row independently, keyed by worker id', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-W1', isActive: true, shareUrl: 'https://example.com/r/REF-W1' }, error: null }),
    )
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-W2', isActive: true, shareUrl: 'https://example.com/r/REF-W2' }, error: null }),
    )

    const toggles = wrapper.findAll('[data-testid="toggle-referral-code"]')
    await toggles[0]!.trigger('click')
    await toggles[1]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const values = wrapper.findAll('[data-testid="referral-code-value"]')
    expect(values.map((v) => v.text())).toEqual(['REF-W1', 'REF-W2'])

    wrapper.unmount()
  })

  it('exposes aria-expanded/aria-controls on the toggle button, bound to the reveal state', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-ARIA', isActive: true, shareUrl: 'https://example.com/r/REF-ARIA' }, error: null }),
    )

    const toggle = wrapper.findAll('[data-testid="toggle-referral-code"]')[0]!
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(toggle.attributes('aria-expanded')).toBe('true')
    const panel = wrapper.get('[data-testid="referral-code-panel"]')
    expect(toggle.attributes('aria-controls')).toBe(panel.attributes('id'))

    wrapper.unmount()
  })

  it('renders the copy-referral-code button as the secondary variant, not primary', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { code: 'REF-VARIANT', isActive: true, shareUrl: 'https://example.com/r/REF-VARIANT' }, error: null }),
    )

    await wrapper.findAll('[data-testid="toggle-referral-code"]')[0]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    const copyButton = wrapper.get('[data-testid="copy-referral-code"]')
    // Secondary variant's fill (border-soft), not primary's (accent-strong) -- the One Seal
    // Rule reserves the accent-filled primary look for this page's real primary action
    // ("افزودن" / add member), not a per-row action that can multiply across reveals.
    expect(copyButton.classes().join(' ')).toContain('border-soft')
    expect(copyButton.classes().join(' ')).not.toContain('accent-strong')

    wrapper.unmount()
  })
})

describe('TeamView loading state', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
  })

  it('shows a loading spinner distinct from the empty state while the initial fetch is pending', async () => {
    let resolveFetch!: (v: { data: typeof workers; error: null }) => void
    fetchMock.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve }),
    )

    const wrapper = mount(TeamView)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="loading-spinner"]').exists()).toBe(true)
    // Empty state must not render while still loading.
    expect(wrapper.text()).not.toContain('هنوز عضوی به تیم اضافه نشده است')

    resolveFetch({ data: [], error: null })
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('هنوز عضوی به تیم اضافه نشده است')

    wrapper.unmount()
  })
})

describe('TeamView add-member form', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return Promise.resolve({ data: [], error: null })
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('sets an inline Persian error instead of failing silently on empty submit', async () => {
    const wrapper = await mountView()

    await wrapper.get('[data-testid="submit-add-worker"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('نام و شماره موبایل الزامی است')
    // No API call was made for the empty submit itself.
    expect(fetchMock).toHaveBeenCalledTimes(1) // only the initial list load
  })

  it('maps a non-409 server error (e.g. phone-format validation) to a fixed Persian message, never the raw server string', async () => {
    const wrapper = await mountView()

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { status: 400, message: 'phone must be a valid Iranian mobile number' } }),
    )

    await wrapper.get('input[placeholder="نام"]').setValue('علی')
    await wrapper.get('input[placeholder="شماره موبایل"]').setValue('123')
    await wrapper.get('[data-testid="submit-add-worker"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('phone must be a valid Iranian mobile number')
    expect(wrapper.text()).toContain('اطلاعات وارد شده نامعتبر است')
  })

  it('still shows the specific duplicate-member message on a 409', async () => {
    const wrapper = await mountView()

    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { status: 409, message: 'this user is already a team member' } }),
    )

    await wrapper.get('input[placeholder="نام"]').setValue('علی')
    await wrapper.get('input[placeholder="شماره موبایل"]').setValue('09121234567')
    await wrapper.get('[data-testid="submit-add-worker"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('این کاربر از قبل عضو تیم است')
  })
})
