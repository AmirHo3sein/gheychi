import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFeatureFlags, useFeatureFlags } from '@/composables/useFeatureFlags'
import { resetSalon, useSalon } from '@/composables/useSalon'
import ReviewsView from './ReviewsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const reviews = [
  {
    id: 'r1',
    rating: 5,
    comment: 'عالی بود',
    salonReply: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  },
  {
    id: 'r2',
    rating: 3,
    comment: 'خوب بود',
    salonReply: 'ممنون از نظر شما',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
]

function page(items: unknown[]) {
  return { items, total: items.length, page: 1, pageSize: 50 }
}

async function mountView() {
  const wrapper = mount(ReviewsView)
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('ReviewsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetSalon()
    resetFeatureFlags()
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
  })

  it('renders a textarea (not a single-line input) for the reply draft, with an accessible label', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page(structuredClone(reviews)), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)

    const label = wrapper.find(`label[for="${textarea.attributes('id')}"]`)
    expect(label.exists()).toBe(true)
  })

  it('uses the text-safe accent token for the reply label, not the fill-only accent token', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page(structuredClone(reviews)), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    const replyLabel = wrapper.findAll('span').find((s) => s.text().includes('پاسخ شما:'))
    expect(replyLabel).toBeTruthy()
    expect(replyLabel!.classes()).toContain('text-(--color-accent-text)')
    expect(replyLabel!.classes()).not.toContain('text-(--color-accent)')
  })

  it('disables the send button when the draft is empty or whitespace-only, and enables it once text is entered', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([structuredClone(reviews[0])]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect((wrapper.get('button').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('textarea').setValue('   ')
    expect((wrapper.get('button').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('textarea').setValue('متشکریم')
    expect((wrapper.get('button').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows a loading state on the send button while the reply request is in flight, and disables it', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([structuredClone(reviews[0])]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()
    await wrapper.get('textarea').setValue('متشکریم')

    let resolveReply!: (value: unknown) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReply = resolve
        }),
    )

    const sendButton = wrapper.get('button')
    await sendButton.trigger('click')

    expect((sendButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(sendButton.attributes('aria-busy')).toBe('true')

    resolveReply({ data: { id: 'r1', salonReply: 'متشکریم' }, error: null })
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect((sendButton.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders a retry-capable error state (not the empty-reviews message) when the initial load fails', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: null, error: { status: 500, message: 'x' } })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.text()).not.toContain('هنوز نظری ثبت نشده است.')
    expect(wrapper.find('[data-testid="retry-reviews"]').exists()).toBe(true)

    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    await wrapper.get('[data-testid="retry-reviews"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="retry-reviews"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('هنوز نظری ثبت نشده است.')
  })

  it('gives the star rating row an accessible label and hides the individual star icons from assistive tech', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([structuredClone(reviews[0])]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    const starRow = wrapper.find('[aria-label*="ستاره"]')
    expect(starRow.exists()).toBe(true)
    expect(starRow.attributes('aria-label')).toContain('۵')

    const stars = starRow.findAll('svg')
    expect(stars.length).toBe(5)
    for (const s of stars) expect(s.attributes('aria-hidden')).toBe('true')
  })

  it('uses the primary button variant for the send action', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([structuredClone(reviews[0])]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    const sendButton = wrapper.get('button')
    expect(sendButton.classes()).toContain('bg-(--color-accent-strong)')
  })

  it('surfaces a relative recency signal on each review card', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([structuredClone(reviews[0])]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('پیش')
  })

  // GET /salons/:id/reviews is paginated (50/page by default) and the page used to read only
  // the first one -- a salon's 51st-and-older reviews were unreachable from here.
  it('pages through the listing with prev/next and a "x of y" indicator, fetching each page on demand', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) {
        const pageNo = Number(new URLSearchParams(path.split('?')[1]).get('page'))
        return Promise.resolve({
          data: { items: [{ ...structuredClone(reviews[0]), id: `r-p${pageNo}` }], total: 120, page: pageNo, pageSize: 50 },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(fetchMock).toHaveBeenCalledWith('/salons/s1/reviews?page=1', { silent: true })
    expect(wrapper.get('[data-testid="reviews-page-indicator"]').text()).toBe('صفحه ۱ از ۳')
    expect((wrapper.get('[data-testid="reviews-prev-page"]').element as HTMLButtonElement).disabled).toBe(true)
    expect((wrapper.get('[data-testid="reviews-next-page"]').element as HTMLButtonElement).disabled).toBe(false)

    await wrapper.get('[data-testid="reviews-next-page"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/salons/s1/reviews?page=2', { silent: true })
    expect(wrapper.get('[data-testid="reviews-page-indicator"]').text()).toBe('صفحه ۲ از ۳')
    expect(wrapper.get('textarea').attributes('id')).toBe('reply-r-p2')
    expect((wrapper.get('[data-testid="reviews-prev-page"]').element as HTMLButtonElement).disabled).toBe(false)

    await wrapper.get('[data-testid="reviews-next-page"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="reviews-page-indicator"]').text()).toBe('صفحه ۳ از ۳')
    expect((wrapper.get('[data-testid="reviews-next-page"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders no pager when everything fits on one page', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page(structuredClone(reviews)), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="reviews-pager"]').exists()).toBe(false)
  })

  // listForSalon returns an empty page while the flag is off, which used to render here as
  // "no reviews yet" -- false for a salon that has plenty. Same banner pattern as
  // StoriesView/PortfolioView, except that here it replaces the (server-gated) list.
  it('shows the disabled banner instead of the empty state (and skips the fetch) when reviews are turned off', async () => {
    useFeatureFlags().flags.value = {
      reviewsEnabled: false,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
      onlinePaymentEnabled: true,
    }
    fetchMock.mockImplementation(() => Promise.resolve({ data: page([]), error: null }))
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="reviews-disabled-banner"]').text()).toContain('موقتاً')
    expect(wrapper.text()).not.toContain('هنوز نظری ثبت نشده است.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows no banner when reviews are enabled', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page([]), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="reviews-disabled-banner"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('هنوز نظری ثبت نشده است.')
  })

  it('shows an unanswered indicator and sorts unanswered reviews ahead of answered ones', async () => {
    // r2 (answered) is listed before r1 (unanswered) in the source data -- the rendered
    // order must flip that so the review needing action surfaces first.
    fetchMock.mockImplementation((path: string) => {
      if (path.startsWith('/salons/s1/reviews?page=')) return Promise.resolve({ data: page(structuredClone([reviews[1], reviews[0]])), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('بدون پاسخ')

    const cards = wrapper.findAll('textarea')
    expect(cards[0]!.attributes('id')).toBe('reply-r1')
    expect(cards[1]!.attributes('id')).toBe('reply-r2')
  })
})
