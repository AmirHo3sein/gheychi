import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PhotosView from './PhotosView.vue'

const PHOTO_COVER = { id: 'p-cover', url: 'http://localhost:3002/uploads/salons/s1/photos/a.jpg', isCover: true, sortOrder: 0 }
const PHOTO_OTHER = { id: 'p-other', url: 'http://localhost:3002/uploads/salons/s1/photos/b.jpg', isCover: false, sortOrder: 1 }

async function mountPhotos() {
  const wrapper = mount(PhotosView)
  await new Promise((r) => setTimeout(r, 0))
  return wrapper
}

describe('PhotosView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading spinner during the initial fetch instead of a blank/empty state', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotosView)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.animate-spin').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('هنوز تصویری بارگذاری نشده است.')

    resolveFetch({ ok: true, status: 200, json: async () => [] })
    await new Promise((r) => setTimeout(r, 0))
  })

  it('shows a retry-capable error state (not the empty-list message) when the initial load fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountPhotos()

    expect(wrapper.text()).not.toContain('هنوز تصویری بارگذاری نشده است.')
    expect(wrapper.find('[data-testid="retry-photos"]').exists()).toBe(true)

    fetchMock.mockClear()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    await wrapper.find('[data-testid="retry-photos"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="retry-photos"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('هنوز تصویری بارگذاری نشده است.')
  })

  it('does not delete a photo without confirmation, and the row stays untouched', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_OTHER] })
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = await mountPhotos()
    await wrapper.find('[data-testid="delete-photo"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).toHaveBeenCalled()
    // Only the initial GET happened -- no DELETE was fired.
    expect(fetchMock.mock.calls.length).toBe(1)
  })

  it('uses generic confirm copy for a non-cover photo delete', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_OTHER] })
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = await mountPhotos()
    await wrapper.find('[data-testid="delete-photo"]').trigger('click')

    expect(confirmSpy).toHaveBeenCalledWith('این تصویر حذف شود؟')
  })

  it('warns distinctly when deleting the current cover photo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_COVER] })
    vi.stubGlobal('fetch', fetchMock)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = await mountPhotos()
    await wrapper.find('[data-testid="delete-photo"]').trigger('click')

    expect(confirmSpy).toHaveBeenCalledWith('این عکس، عکس اصلی شماست. حذف شود؟')
  })

  it('deletes a photo after confirmation, removing the row only on success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_OTHER] }) // GET photos
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }) // DELETE photo
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = await mountPhotos()
    await wrapper.find('[data-testid="delete-photo"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const deleteCall = fetchMock.mock.calls[1]!
    expect(deleteCall[0]).toContain('/salons/mine/photos/p-other')
    expect(deleteCall[1]).toMatchObject({ method: 'DELETE' })
    expect(wrapper.find('[data-testid="delete-photo"]').exists()).toBe(false)
  })

  it('does not remove the row locally when the delete request fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_OTHER] }) // GET photos
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) // DELETE fails
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const wrapper = await mountPhotos()
    await wrapper.find('[data-testid="delete-photo"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="delete-photo"]').exists()).toBe(true)
  })

  it('sets a new cover only on a successful PATCH', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_COVER, PHOTO_OTHER] }) // GET photos
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...PHOTO_OTHER, isCover: true }) }) // PATCH
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountPhotos()
    const setCoverButtons = wrapper.findAll('[data-testid="set-cover"]')
    // The second card (p-other) is not the cover yet -- its button is enabled.
    await setCoverButtons[1]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const patchCall = fetchMock.mock.calls[1]!
    expect(patchCall[0]).toContain('/salons/mine/photos/p-other')
    expect(JSON.parse(patchCall[1].body)).toEqual({ isCover: true })
    expect(wrapper.findAll('[data-testid="set-cover"]')[1]!.text()).toBe('انتخاب شده')
  })
  // Layout regression. The delete button used to share a footer row with the
  // «انتخاب به‌عنوان اصلی» button; together they needed ~210px against the ~122px of footer
  // a tile has at 320px (and still only ~178px at md), and because the tile is
  // `overflow-hidden` the delete button was silently CLIPPED rather than visibly overflowing.
  // It now overlays the image, where it keeps its full 44px target at every width.
  it('renders the delete control as an image overlay, not inside the clipped footer row', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PHOTO_COVER] })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = await mountPhotos()
    const del = wrapper.get('[data-testid="delete-photo"]')

    expect(del.classes()).toContain('absolute')
    // start-*, never left-*/right-*: an RTL overflow escapes off the LEFT edge.
    expect(del.classes()).toContain('start-2')
    // The cover badge pins to the opposite corner (end-2), so the two never collide.
    expect(del.element.parentElement?.querySelector('img')).toBeTruthy()
    // The footer now holds the cover action alone, full width.
    expect(wrapper.get('[data-testid="set-cover"]').classes()).toContain('w-full')
  })
})
