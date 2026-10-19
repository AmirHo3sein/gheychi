import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { PushState } from '@/composables/usePushNotifications'

const state = ref<PushState>('off')
const enable = vi.fn()
const disable = vi.fn()
const refresh = vi.fn()
vi.mock('@/composables/usePushNotifications', () => ({
  usePushNotifications: () => ({ state, busy: ref(false), refresh, enable, disable }),
}))

const { default: PushNotificationsCard } = await import('./PushNotificationsCard.vue')

describe('PushNotificationsCard', () => {
  it('reads the real state on mount and offers the matching action', async () => {
    state.value = 'off'
    const w = mount(PushNotificationsCard)
    await flushPromises()
    expect(refresh).toHaveBeenCalled()
    await w.get('[data-testid="push-enable"]').trigger('click')
    expect(enable).toHaveBeenCalled()

    state.value = 'on'
    await flushPromises()
    expect(w.find('[data-testid="push-on-badge"]').exists()).toBe(true)
    await w.get('[data-testid="push-disable"]').trigger('click')
    expect(disable).toHaveBeenCalled()
  })

  it.each([
    ['unsupported', 'push-unsupported'],
    ['unconfigured', 'push-unconfigured'],
    ['denied', 'push-denied'],
  ] as const)('explains %s instead of offering a switch that cannot work', async (s, testid) => {
    state.value = s
    const w = mount(PushNotificationsCard)
    await flushPromises()
    expect(w.find(`[data-testid="${testid}"]`).exists()).toBe(true)
    expect(w.find('[data-testid="push-enable"]').exists()).toBe(false)
    expect(w.find('[data-testid="push-disable"]').exists()).toBe(false)
  })
})
