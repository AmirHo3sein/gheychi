import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { usePhoneUserSearch } from './usePhoneUserSearch'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

function mountSearch() {
  let api!: ReturnType<typeof usePhoneUserSearch>
  mount(defineComponent({ setup() { api = usePhoneUserSearch(); return () => h('div') } }))
  return api
}

describe('usePhoneUserSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ data: { items: [], total: 0 }, error: null })
  })
  afterEach(() => vi.useRealTimers())

  // Phones display in Persian digits across the panel, so a pasted or Persian-keyboard query
  // must reach the ASCII-stored ILIKE search normalized, or it never matches anyone.
  it('normalizes Persian and Arabic-Indic digits to ASCII before searching', async () => {
    const search = mountSearch()
    search.phoneQuery.value = ' ۰۹۱٢۳ '
    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/admin/users?phone=09123', { silent: true })
  })
})
