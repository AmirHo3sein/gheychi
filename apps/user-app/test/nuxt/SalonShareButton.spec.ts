import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import SalonShareButton from '../../app/components/salon/SalonShareButton.vue'

function setNavigator(props: Record<string, unknown>) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
  }
}

describe('SalonShareButton', () => {
  beforeEach(() => {
    useState('toasts').value = []
  })

  afterEach(() => {
    setNavigator({ share: undefined, canShare: undefined, clipboard: undefined })
  })

  it('opens the native share sheet with the attributed salon link', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share, canShare: undefined, clipboard: undefined })
    const wrapper = await mountSuspended(SalonShareButton, { props: { slug: 'nemune', salonName: 'سالن نمونه' } })

    await wrapper.get('[data-testid="salon-share-button"]').trigger('click')
    await flushPromises()

    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: 'سالن نمونه',
      url: `${window.location.origin}/salons/nemune?source=direct`,
    }))
    expect(useState<unknown[]>('toasts').value).toHaveLength(0)
  })

  it('copies the link and confirms with a toast when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator({ share: undefined, canShare: undefined, clipboard: { writeText } })
    const wrapper = await mountSuspended(SalonShareButton, { props: { slug: 'nemune', salonName: 'سالن نمونه' } })

    await wrapper.get('[data-testid="salon-share-button"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/salons/nemune?source=direct`)
    const toasts = useState<Array<{ message: string; tone: string }>>('toasts').value
    expect(toasts.at(-1)).toMatchObject({ message: 'پیوند سالن کپی شد', tone: 'success' })
  })
})
