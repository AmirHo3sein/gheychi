import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import ErrorPage from '../../app/error.vue'

// clearError({ redirect }) is what actually takes the visitor off the error screen.
const { clearErrorMock } = vi.hoisted(() => ({ clearErrorMock: vi.fn() }))
mockNuxtImport('clearError', () => clearErrorMock)

function err(statusCode: number, statusMessage = 'whatever the server said') {
  return { statusCode, statusMessage, message: statusMessage, fatal: false, unhandled: false } as never
}

describe('app/error.vue', () => {
  beforeEach(() => clearErrorMock.mockReset())

  it('says in Persian that a 404 page was not found, never echoing the English server message', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(404, 'Service not found') } })
    expect(wrapper.get('[data-testid="error-heading"]').text()).toBe('صفحه‌ای که دنبالش بودید پیدا نشد')
    expect(wrapper.text()).toContain('۴۰۴')
    expect(wrapper.text()).not.toContain('Service not found')
  })

  it.each([500, 502, 503, undefined as unknown as number])('shows the generic Persian message for status %s', async (status) => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(status, 'Internal Server Error') } })
    expect(wrapper.get('[data-testid="error-heading"]').text()).toBe('مشکلی پیش آمد')
    expect(wrapper.text()).not.toContain('Internal Server Error')
    expect(wrapper.text()).not.toContain('۴۰۴')
  })

  it('distinguishes a 403 from a generic failure', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(403) } })
    expect(wrapper.get('[data-testid="error-heading"]').text()).toBe('اجازه دیدن این صفحه را ندارید')
  })

  it('offers a primary home action and a secondary salons action that clear the error and navigate', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(404) } })
    const home = wrapper.get('[data-testid="error-home"]')
    const salons = wrapper.get('[data-testid="error-salons"]')
    expect(home.text()).toBe('بازگشت به خانه')
    expect(salons.text()).toBe('سالن‌های زیبایی')

    await home.trigger('click')
    expect(clearErrorMock).toHaveBeenLastCalledWith({ redirect: '/' })
    await salons.trigger('click')
    expect(clearErrorMock).toHaveBeenLastCalledWith({ redirect: '/salons' })
  })

  it('announces itself as an alert and carries the brand mark', async () => {
    const wrapper = await mountSuspended(ErrorPage, { props: { error: err(500) } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('img[src="/brand-icon.png"]').exists()).toBe(true)
  })

  it('is noindex', async () => {
    await mountSuspended(ErrorPage, { props: { error: err(404) } })
    // Head DOM writes are debounced by unhead, so poll rather than asserting synchronously.
    await vi.waitFor(() => {
      const robots = document.head.querySelector('meta[name="robots"]')
      expect(robots?.getAttribute('content')).toBe('noindex, nofollow')
    })
  })
})
