import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import ThemeToggle from '../../app/components/layout/ThemeToggle.vue'

enableAutoUnmount(afterEach)

type Listener = (e: { matches: boolean }) => void

function stubScheme(dark: boolean) {
  const listeners = new Set<Listener>()
  const mq = {
    matches: dark,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mq))
  return {
    set(next: boolean) {
      mq.matches = next
      listeners.forEach((l) => l({ matches: next }))
    },
    listeners,
  }
}

describe('ThemeToggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useCookie('theme').value = null
    useState('theme-system-dark').value = false
    document.documentElement.classList.remove('dark')
  })

  it('resolves a dark OS scheme after mount when no theme was chosen', async () => {
    stubScheme(true)
    const wrapper = await mountSuspended(ThemeToggle)
    await nextTick()
    expect(wrapper.get('button').attributes('title')).toBe('حالت روشن')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('follows an OS scheme change while the preference is still "system", and stops listening on unmount', async () => {
    const scheme = stubScheme(false)
    const wrapper = await mountSuspended(ThemeToggle)
    expect(wrapper.get('button').attributes('title')).toBe('حالت تیره')
    scheme.set(true)
    await nextTick()
    expect(wrapper.get('button').attributes('title')).toBe('حالت روشن')
    wrapper.unmount()
    expect(scheme.listeners.size).toBe(0)
  })

  it('an explicit light choice wins over a dark OS scheme', async () => {
    stubScheme(true)
    useCookie('theme').value = 'light'
    const wrapper = await mountSuspended(ThemeToggle)
    await nextTick()
    expect(wrapper.get('button').attributes('title')).toBe('حالت تیره')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
