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

  it('POSTs the default endpoint with only the file field when no props are passed (PhotosView behavior pinned)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'p1', url: 'u', isCover: false, sortOrder: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader)
    const file = new File(['bytes'], 'a.jpg', { type: 'image/jpeg' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[0]![0]).toContain('/salons/mine/photos')
    const body = fetchMock.mock.calls[0]![1].body as FormData
    expect([...body.keys()]).toEqual(['file'])
  })

  it('POSTs a custom endpoint with extraFields appended to the multipart form', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: 'st1', url: 'u', caption: 'کپشن', serviceId: 'svc-1', status: 'published' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader, {
      props: { endpoint: '/salons/mine/stories', extraFields: { caption: 'کپشن', serviceId: 'svc-1' } },
    })
    const file = new File(['bytes'], 'a.jpg', { type: 'image/jpeg' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock.mock.calls[0]![0]).toContain('/salons/mine/stories')
    const body = fetchMock.mock.calls[0]![1].body as FormData
    expect(body.get('caption')).toBe('کپشن')
    expect(body.get('serviceId')).toBe('svc-1')
    expect(body.get('file')).toBeInstanceOf(File)
    expect(wrapper.emitted('uploaded')?.[0]?.[0]).toMatchObject({ id: 'st1' })
  })

  it('surfaces the API 409 cap message inline instead of the generic failure text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'حداکثر ۱۰ استوری فعال مجاز است' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PhotoUploader, { props: { endpoint: '/salons/mine/stories' } })
    const file = new File(['bytes'], 'a.jpg', { type: 'image/jpeg' })
    const input = wrapper.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('حداکثر ۱۰ استوری فعال مجاز است')
    expect(wrapper.emitted('uploaded')).toBeUndefined()
  })
})
