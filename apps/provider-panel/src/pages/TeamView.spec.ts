import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppMultiSelect from '@/components/ui/AppMultiSelect.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
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
    expect(fetchMock).toHaveBeenCalledTimes(4) // initial list + services + exceptions + referral-code fetch

    await toggle.trigger('click') // hide
    expect(wrapper.find('[data-testid="referral-code-panel"]').exists()).toBe(false)

    await toggle.trigger('click') // show again -- no new fetch
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(4)
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

describe('TeamView per-worker service restriction', () => {
  const workersWithServices = [
    { id: 'w1', name: 'سارا', active: true, ratingAvg: '4.50', ratingCount: 2, createdAt: '2026-07-01T00:00:00.000Z', serviceIds: [] },
    { id: 'w2', name: 'مریم', active: true, ratingAvg: '0.00', ratingCount: 0, createdAt: '2026-07-02T00:00:00.000Z', serviceIds: ['svc-1'] },
  ]
  const salonServices = [
    { id: 'svc-1', name: 'کوتاهی مو' },
    { id: 'svc-2', name: 'رنگ مو' },
  ]

  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return Promise.resolve({ data: structuredClone(workersWithServices), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(salonServices), error: null })
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('shows the unrestricted hint for a worker with no serviceIds, and the restricted hint for one with some', async () => {
    const wrapper = await mountView()

    const cards = wrapper.findAll('[data-testid="worker-services-select"]')
    expect(cards).toHaveLength(2)
    expect(wrapper.text()).toContain('این عضو می‌تواند همه خدمات سالن را انجام دهد.')
    expect(wrapper.text()).toContain('این عضو فقط خدمات انتخاب‌شده را انجام می‌دهد.')

    wrapper.unmount()
  })

  it('PATCHes the worker services endpoint and updates local state when the selection changes', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { id: 'w1', serviceIds: ['svc-2'] }, error: null }),
    )

    const select = wrapper.findAllComponents(AppMultiSelect)[0]!
    await select.vm.$emit('update:modelValue', ['svc-2'])
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/workers/w1/services', {
      method: 'PATCH',
      body: { serviceIds: ['svc-2'] },
    })
    expect(wrapper.text()).toContain('این عضو فقط خدمات انتخاب‌شده را انجام می‌دهد.')

    wrapper.unmount()
  })

  it('does not render the services picker at all when the salon has no services yet', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return Promise.resolve({ data: structuredClone(workersWithServices), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: [], error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="worker-services-select"]').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('TeamView per-worker time off', () => {
  const exceptions = [
    { id: 'e-past', date: '2020-01-01', workerId: 'w1' },
    { id: 'e-w1', date: '2099-01-01', workerId: 'w1' },
    { id: 'e-whole-salon', date: '2099-03-03', workerId: null },
  ]

  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return Promise.resolve({ data: structuredClone(workers), error: null })
      if (path === '/salons/mine/exceptions') return Promise.resolve({ data: structuredClone(exceptions), error: null })
      return Promise.resolve({ data: null, error: null })
    })
  })

  it("lists every one of a worker's own days off (past included), but never a whole-salon closure", async () => {
    const wrapper = await mountView()

    // w1 (Sara) has both of her own rows in the fixture -- a past date isn't filtered out
    // (matching HoursView.vue's own unfiltered whole-salon exceptions list: hiding a
    // just-created row because it happened to land in the past would look like "add" did
    // nothing). The whole-salon row (workerId: null) must never appear under any worker.
    expect(wrapper.find('[data-testid="worker-off-e-w1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="worker-off-e-past"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="worker-off-e-whole-salon"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows the empty-state hint for a worker with no upcoming days off', async () => {
    const wrapper = await mountView()

    // w2 (Maryam) has no rows at all in the fixture.
    expect(wrapper.text()).toContain('این عضو مرخصی ثبت‌شده‌ای ندارد.')

    wrapper.unmount()
  })

  it('adds a day off for a specific worker', async () => {
    const wrapper = await mountView()
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve({ data: { id: 'new-e', date: '2099-06-06', workerId: 'w2' }, error: null }),
    )

    wrapper.findComponent<typeof JalaliDatePicker>('[data-testid="worker-off-date-w2"]').vm.$emit('update:modelValue', '2099-06-06')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="add-worker-off-w2"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/exceptions', {
      method: 'POST',
      body: { date: '2099-06-06', workerId: 'w2' },
    })
    expect(wrapper.find('[data-testid="worker-off-new-e"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('does not add a day off without a date chosen', async () => {
    const wrapper = await mountView()
    fetchMock.mockClear()

    await wrapper.get('[data-testid="add-worker-off-w2"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('removes a worker day off only after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountView()
    fetchMock.mockClear()

    await wrapper.get('[data-testid="remove-worker-off-e-w1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="worker-off-e-w1"]').exists()).toBe(true)

    confirmSpy.mockReturnValue(true)
    await wrapper.get('[data-testid="remove-worker-off-e-w1"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/exceptions/e-w1', { method: 'DELETE' })
    expect(wrapper.find('[data-testid="worker-off-e-w1"]').exists()).toBe(false)

    wrapper.unmount()
  })
})

describe('TeamView loading state', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
  })

  it('shows a loading spinner distinct from the empty state while the initial fetch is pending', async () => {
    // load() fires the workers, services, AND exceptions fetches in a Promise.all -- each
    // needs its own resolver, not one shared variable a later call would silently overwrite.
    let resolveWorkers!: (v: { data: typeof workers; error: null }) => void
    let resolveServices!: (v: { data: unknown[]; error: null }) => void
    let resolveExceptions!: (v: { data: unknown[]; error: null }) => void
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return new Promise((resolve) => { resolveWorkers = resolve })
      if (path === '/salons/mine/services') return new Promise((resolve) => { resolveServices = resolve })
      return new Promise((resolve) => { resolveExceptions = resolve })
    })

    const wrapper = mount(TeamView)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="loading-spinner"]').exists()).toBe(true)
    // Empty state must not render while still loading.
    expect(wrapper.text()).not.toContain('هنوز عضوی به تیم اضافه نشده است')

    resolveWorkers({ data: [], error: null })
    resolveServices({ data: [], error: null })
    resolveExceptions({ data: [], error: null })
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('هنوز عضوی به تیم اضافه نشده است')

    wrapper.unmount()
  })
})

describe('TeamView load error', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
  })

  it('shows a distinct error state (not the empty state) when either fetch fails, and retry reloads', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ data: null, error: { status: 500, message: 'Something went wrong' } }))
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('هنوز عضوی به تیم اضافه نشده است')

    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/workers') return Promise.resolve({ data: structuredClone(workers), error: null })
      return Promise.resolve({ data: [], error: null })
    })
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سارا')
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
    expect(fetchMock).toHaveBeenCalledTimes(3) // only the initial list + services + exceptions load
  })

  it('ignores a second click on «افزودن» while the create request is still in flight', async () => {
    const wrapper = await mountView()

    let resolveCreate!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve }))

    await wrapper.get('input[placeholder="نام"]').setValue('علی')
    await wrapper.get('input[placeholder="شماره موبایل"]').setValue('09121234567')
    const submit = wrapper.get('[data-testid="submit-add-worker"]')
    await submit.trigger('click')
    await submit.trigger('click')
    await wrapper.vm.$nextTick()

    const posts = fetchMock.mock.calls.filter(([path, opts]) => path === '/salons/mine/workers' && opts?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    expect(submit.attributes('aria-busy')).toBe('true')

    resolveCreate({
      data: { id: 'w3', name: 'علی', active: true, ratingAvg: '0.00', ratingCount: 0, createdAt: '2026-07-03T00:00:00.000Z', serviceIds: [] },
      error: null,
    })
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.text()).toContain('علی')
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
