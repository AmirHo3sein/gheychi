import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  PENDING_POLL_INTERVAL_MS,
  readSalonBookings,
  reportBookings,
  resetPendingApprovals,
  usePendingApprovalCount,
  usePendingApprovalPolling,
  usePendingApprovalsFeed,
} from './usePendingApprovals'
import { useApi } from './useApi'
import { resetSalon, useSalon } from './useSalon'
import { resetToast, useToast } from './useToast'

const Layout = defineComponent({
  setup() {
    usePendingApprovalPolling()
    return () => h('div')
  },
})
const FeedingPage = defineComponent({
  setup() {
    usePendingApprovalsFeed()
    return () => h('div')
  },
})

function approve() {
  const { salon } = useSalon()
  salon.value = {
    id: 's1',
    name: 'x',
    slug: 'x',
    status: 'approved',
    genderTarget: 'women',
    address: 'x',
    city: 'x',
    capacity: 1,
    rejectionReason: null,
  }
}

function stubBookings(lists: Array<Array<{ id: string; status: string }>>) {
  let call = 0
  const fetchMock = vi.fn(() => {
    const body = lists[Math.min(call, lists.length - 1)]
    call += 1
    return Promise.resolve({ ok: true, status: 200, json: async () => body })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const flush = () => new Promise((r) => setTimeout(r, 0))

// The salon/pending state is module-level, so a component left mounted by one test would keep
// its watchers alive and react to the next test's setup.
enableAutoUnmount(afterEach)

describe('usePendingApprovals', () => {
  beforeEach(() => {
    resetPendingApprovals()
    resetSalon()
    resetToast()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reads once on mount and counts only pending_approval bookings', async () => {
    approve()
    stubBookings([[{ id: 'a', status: 'pending_approval' }, { id: 'b', status: 'confirmed' }]])
    mount(Layout)
    await flush()
    expect(usePendingApprovalCount().value).toBe(1)
  })

  // A real page load mounts the layout before useSalon's own request has resolved, so the
  // salon is still null on mount and the approved-only guard skips the mount-time read. The
  // badge/callout must still appear as soon as the salon turns out to be approved -- not 30s
  // later on the next interval tick.
  it('reads as soon as the salon loads as approved when it was not loaded yet on mount', async () => {
    const fetchMock = stubBookings([[{ id: 'a', status: 'pending_approval' }]])
    mount(Layout)
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    approve()
    await flush()
    await flush()
    expect(usePendingApprovalCount().value).toBe(1)
  })

  it('announces a request that arrives after the first read, but not the queue already there', async () => {
    vi.useFakeTimers()
    approve()
    stubBookings([
      [{ id: 'a', status: 'pending_approval' }],
      [{ id: 'a', status: 'pending_approval' }, { id: 'b', status: 'pending_approval' }],
    ])
    mount(Layout)
    await vi.advanceTimersByTimeAsync(0)
    expect(useToast().toasts.value).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(PENDING_POLL_INTERVAL_MS)
    expect(usePendingApprovalCount().value).toBe(2)
    expect(useToast().toasts.value.map((t) => t.message)).toEqual(['درخواست نوبت جدیدی دریافت شد'])
  })

  it('stands down while a page feeds the count, and never re-announces what that page saw', async () => {
    vi.useFakeTimers()
    approve()
    const fetchMock = stubBookings([[{ id: 'a', status: 'pending_approval' }]])
    mount(FeedingPage)
    mount(Layout)
    reportBookings([{ id: 'a', status: 'pending_approval' }])
    await vi.advanceTimersByTimeAsync(PENDING_POLL_INTERVAL_MS * 2)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(usePendingApprovalCount().value).toBe(1)
    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('does not poll for a salon that is not approved', async () => {
    const fetchMock = stubBookings([[]])
    mount(Layout)
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Regression: a read in flight at logout used to land after resetPendingApprovals() and
  // write the previous salon's queue (and seen-set) back into the singleton, so the next
  // account on this tab saw the old badge and had its own queue announced as "new".
  it('drops a read that was in flight when the state was reset (logout)', async () => {
    approve()
    let resolveRead: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolveRead = r })))
    mount(Layout)
    await flush()
    resetPendingApprovals()
    resolveRead({ ok: true, status: 200, json: async () => [{ id: 'old', status: 'pending_approval' }] })
    await flush()
    await flush()
    expect(usePendingApprovalCount().value).toBe(0)
  })

  // Regression: the dashboard read GET /salons/mine/bookings on mount while the layout's poll
  // read the very same list on mount -- two identical 1000-row reads per dashboard visit.
  it('shares one in-flight bookings read between the layout poll and a page that needs the list', async () => {
    approve()
    const fetchMock = stubBookings([[{ id: 'a', status: 'pending_approval' }]])
    const ListPage = defineComponent({
      setup() {
        const { apiFetch } = useApi()
        void readSalonBookings(apiFetch)
        return () => h('div')
      },
    })
    const LayoutWithPage = defineComponent({
      setup() {
        usePendingApprovalPolling()
        return () => h(ListPage)
      },
    })
    mount(LayoutWithPage)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(usePendingApprovalCount().value).toBe(1)
  })
})
