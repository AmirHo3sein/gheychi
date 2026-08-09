import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import WalletPage from '../../app/pages/account/wallet.vue'

// Same reasoning as blog-index.spec.ts: page-turn state lives in route.query, and the
// real Nuxt test router doesn't reliably re-navigate a query-only push here -- pin
// useRoute/useRouter to a minimal, directly-controllable pair.
const mockRoute = reactive<{ query: Record<string, string> }>({ query: {} })
mockNuxtImport('useRoute', () => () => mockRoute)
mockNuxtImport('useRouter', () => () => ({
  push: (to: { query?: Record<string, string> }) => {
    mockRoute.query = to.query ?? {}
    return Promise.resolve()
  },
  replace: (to: { query?: Record<string, string> } | string) => {
    if (typeof to === 'object') mockRoute.query = to.query ?? {}
    return Promise.resolve()
  },
  resolve: (to: string | { path?: string }) => ({ href: typeof to === 'string' ? to : (to.path ?? '/') }),
}))

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const TX_CREDIT = {
  id: 't1',
  currency: 'toman',
  amount: 50_000,
  balanceAfter: 50_000,
  type: 'admin_adjustment' as const,
  reason: 'جبران خطای رزرو',
  createdAt: '2026-07-18T08:00:00.000Z',
}

const TX_DEBIT = {
  id: 't2',
  currency: 'toman',
  amount: -20_000,
  balanceAfter: 30_000,
  type: 'admin_adjustment' as const,
  reason: null,
  createdAt: '2026-07-19T08:00:00.000Z',
}

// Dispatch by URL -- the page fetches balances and the transaction list in the same setup.
function stub(balances: unknown[], items: unknown[], total: number, pageSize = 20) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/wallet/mine') return { balances }
    if (path === '/wallet/mine/transactions') return { items, total, page: 1, pageSize }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('account wallet page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockRoute.query = {}
    vi.stubGlobal('$fetch', fetchStub)
    // mountSuspended shares one Nuxt app instance across tests in this file, so the
    // 'wallet-balances'/'wallet-transactions' useAsyncData payload cache would otherwise
    // leak the first test's response into the second mount instead of re-fetching.
    clearNuxtData(['wallet-balances', 'wallet-transactions'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the balance card and a signed, colored transaction list', async () => {
    stub([{ currency: 'toman', balance: 30_000 }], [TX_DEBIT, TX_CREDIT], 2)
    const wrapper = await mountSuspended(WalletPage)

    expect(wrapper.find('[data-testid="wallet-balance"]').text()).toContain('تومان')
    // Toman amounts render fa-IR digit-grouped (formatToman), matching every other numeric
    // display in this app.
    expect(wrapper.text()).toContain('۳۰٬۰۰۰')

    const rows = wrapper.findAll('[data-testid="wallet-transaction"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('۲۰٬۰۰۰')
    expect(rows[0]!.find('[data-testid="wallet-transaction-amount"]').classes()).toContain('text-(--color-danger)')
    expect(rows[1]!.text()).toContain('+۵۰٬۰۰۰')
    expect(rows[1]!.find('[data-testid="wallet-transaction-amount"]').classes()).toContain('text-(--color-success)')
    expect(rows[1]!.text()).toContain('جبران خطای رزرو')
  })

  it('does not render a balance card when the wallet has never been touched', async () => {
    stub([], [], 0)
    const wrapper = await mountSuspended(WalletPage)

    expect(wrapper.find('[data-testid="wallet-balances"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="empty-state"]').text()).toContain('هنوز تراکنشی')
  })

  it('shows pagination controls once results exceed one page, sized to the 44px touch-target minimum', async () => {
    stub([{ currency: 'toman', balance: 30_000 }], [TX_CREDIT], 45)
    const wrapper = await mountSuspended(WalletPage)

    expect(wrapper.find('[data-testid="next-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="prev-page"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="next-page"]').classes()).toContain('min-h-11')
  })

  it('disables pagination and shows a spinner while a page turn is in flight', async () => {
    stub([{ currency: 'toman', balance: 30_000 }], [TX_CREDIT], 45)
    const wrapper = await mountSuspended(WalletPage)

    fetchMock.mockImplementation((path: string) => {
      if (path === '/wallet/mine/transactions') return new Promise(() => {}) // never resolves
      return Promise.resolve({ balances: [{ currency: 'toman', balance: 30_000 }] })
    })

    await wrapper.find('[data-testid="next-page"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="next-page"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="prev-page"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('nav svg.animate-spin').exists()).toBe(true)
  })
})
