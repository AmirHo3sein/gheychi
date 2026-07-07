import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PhotoUploader from './PhotoUploader.vue'

describe('PhotoUploader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads a selected image file and emits uploaded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'p1', url: 'http://localhost:3002/uploads/x.jpg', isCover: true, sortOrder: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader)
    const file = new File(['bytes'], 'a.jpg', { type: 'image/jpeg' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[0]![0]).toContain('/salons/mine/photos')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' })
    expect(wrapper.emitted('uploaded')?.[0]).toEqual([{ id: 'p1', url: 'http://localhost:3002/uploads/x.jpg', isCover: true, sortOrder: 0 }])
  })

  it('rejects a non-image file client-side without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader)
    const file = new File(['bytes'], 'a.txt', { type: 'text/plain' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('تصویر')
  })
})
