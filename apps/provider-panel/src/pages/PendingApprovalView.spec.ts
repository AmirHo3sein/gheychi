import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSalon } from '@/composables/useSalon'
import PendingApprovalView from './PendingApprovalView.vue'

describe('PendingApprovalView', () => {
  beforeEach(() => {
    resetSalon()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a pending message for a pending salon', () => {
    vi.stubGlobal('fetch', vi.fn())
    const wrapper = mount(PendingApprovalView, {
      global: { provide: {} },
      props: {},
    })
    expect(wrapper.text()).toContain('بررسی')
  })

  it('re-fetches the salon when the refresh button is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'approved' }) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PendingApprovalView)
    await wrapper.find('[data-testid="refresh-status"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/salons/mine'), expect.anything())
  })
})
