import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RemoveServiceImageAction from './RemoveServiceImageAction.vue'
import { resetToast, useToast } from '@/composables/useToast'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountAction = () => mount(RemoveServiceImageAction, { props: { serviceId: 's2', serviceName: 'رنگ' }, attachTo: document.body })

describe('RemoveServiceImageAction', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
  })

  it('is a real, labelled button that only opens a confirm strip on first click', async () => {
    const wrapper = mountAction()
    const trigger = wrapper.get('[data-testid="remove-service-image"]')
    expect(trigger.element.tagName).toBe('BUTTON')
    expect(trigger.attributes('type')).toBe('button')
    expect(trigger.attributes('aria-label')).toBe('حذف تصویر خدمت رنگ')

    await trigger.trigger('click')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    const strip = wrapper.get('[data-testid="remove-service-image-strip"]')
    expect(strip.text()).toContain('برای همیشه حذف می‌شود')
    expect(strip.text()).toContain('سالن باید تصویر جدیدی بارگذاری کند')
    // Focus follows the swap onto the confirm control.
    expect(document.activeElement).toBe(wrapper.get('[data-testid="remove-service-image-confirm"]').element)
    wrapper.unmount()
  })

  it('confirming sends exactly one DELETE, toasts success and emits removed', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's2', imageUrl: null }, error: null })
    const wrapper = mountAction()
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
    await wrapper.get('[data-testid="remove-service-image-confirm"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // silent: the component toasts errors itself so a 409 is not shown as a failure.
    expect(fetchMock).toHaveBeenCalledWith('/admin/services/s2/image', { method: 'DELETE', silent: true })
    expect(wrapper.emitted('removed')).toEqual([['s2']])
    expect(useToast().toasts.value).toEqual([expect.objectContaining({ tone: 'success', message: expect.stringContaining('رنگ') })])
    wrapper.unmount()
  })

  it('disables the confirm controls while the request is in flight', async () => {
    let resolve!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const wrapper = mountAction()
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
    await wrapper.get('[data-testid="remove-service-image-confirm"]').trigger('click')

    expect(wrapper.get('[data-testid="remove-service-image-confirm"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="remove-service-image-cancel"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="remove-service-image-confirm"]').trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolve({ data: { id: 's2', imageUrl: null }, error: null })
    await flushPromises()
    wrapper.unmount()
  })

  it('cancelling sends nothing and returns to the trigger', async () => {
    const wrapper = mountAction()
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
    await wrapper.get('[data-testid="remove-service-image-cancel"]').trigger('click')
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('removed')).toBeUndefined()
    expect(wrapper.find('[data-testid="remove-service-image-strip"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[data-testid="remove-service-image"]').element)
    wrapper.unmount()
  })

  it('a server error keeps the image (no removed event, no success toast)', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'خطایی رخ داد' } })
    const wrapper = mountAction()
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
    await wrapper.get('[data-testid="remove-service-image-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('removed')).toBeUndefined()
    expect(useToast().toasts.value.some((t) => t.tone === 'success')).toBe(false)
    expect(wrapper.find('[data-testid="remove-service-image"]').exists()).toBe(true)
    // The request is silent, so the component itself toasts the server's message as an error.
    expect(useToast().toasts.value).toEqual([expect.objectContaining({ tone: 'error', message: 'خطایی رخ داد' })])
    expect(document.activeElement).toBe(wrapper.get('[data-testid="remove-service-image"]').element)
    wrapper.unmount()
  })

  it('a 401 is left to the login redirect: no toast, no removed event', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 401, message: 'Unauthorized' } })
    const wrapper = mountAction()
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
    await wrapper.get('[data-testid="remove-service-image-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('removed')).toBeUndefined()
    expect(useToast().toasts.value).toEqual([])
    wrapper.unmount()
  })

  it('a 409 (image already gone) is reported as information, not failure, and still emits removed', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 409, message: 'این خدمت تصویری ندارد' } })
    const wrapper = mountAction()
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
    await wrapper.get('[data-testid="remove-service-image-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('removed')).toEqual([['s2']])
    // Exactly one neutral toast -- no red error (silent request) and no success.
    expect(useToast().toasts.value).toEqual([expect.objectContaining({ tone: 'info', message: 'تصویر این خدمت پیش‌تر حذف شده است' })])
    wrapper.unmount()
  })

  it('scrolls the whole warning into view when it opens (the services table scrolls sideways on phones)', async () => {
    const spy = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = spy
    try {
      const wrapper = mountAction()
      await wrapper.get('[data-testid="remove-service-image"]').trigger('click')
      await flushPromises()
      const strip = wrapper.get('[data-testid="remove-service-image-strip"]').element
      expect(spy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
      expect(spy.mock.contexts[0]).toBe(strip)
      expect(document.activeElement).toBe(wrapper.get('[data-testid="remove-service-image-confirm"]').element)
      wrapper.unmount()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
