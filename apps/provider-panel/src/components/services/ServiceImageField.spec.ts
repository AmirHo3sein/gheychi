import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServiceImageField from './ServiceImageField.vue'
import { initialImageDraft, type ServiceImageDraft } from './service-image-draft'

const jpeg = (size = 10, name = 'a.jpg') => new File([new Uint8Array(size)], name, { type: 'image/jpeg' })

// Drives the component the way ServicesView does: a v-model the test owns, so every emitted
// draft is fed straight back in and the next assertion sees the re-rendered state.
function mountField(initial: ServiceImageDraft, props: Record<string, unknown> = {}) {
  const wrapper: VueWrapper = mount(ServiceImageField, {
    props: {
      modelValue: initial,
      serviceName: 'کوتاهی مو',
      'onUpdate:modelValue': (draft: ServiceImageDraft) => wrapper.setProps({ modelValue: draft }),
      ...props,
    },
  })
  return wrapper
}

async function pick(wrapper: VueWrapper, file: File | null) {
  const input = wrapper.get('[data-testid="service-image-input"]')
  Object.defineProperty(input.element, 'files', { value: file ? [file] : [], configurable: true })
  await input.trigger('change')
}

const state = (wrapper: VueWrapper) => wrapper.get('[data-testid="service-image-field"]').attributes('data-state')
const draft = (wrapper: VueWrapper) => (wrapper.props() as { modelValue: ServiceImageDraft }).modelValue

describe('ServiceImageField', () => {
  let created: string[]
  let revoked: string[]

  beforeEach(() => {
    created = []
    revoked = []
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:preview-${++n}`
      created.push(url)
      return url
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('(1) no image: neutral placeholder, a pick button, nothing to remove or undo', () => {
    const wrapper = mountField(initialImageDraft(null))
    expect(state(wrapper)).toBe('none')
    expect(wrapper.find('[data-testid="service-image-placeholder"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="service-image-preview"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="pick-service-image"]').text()).toContain('انتخاب تصویر')
    expect(wrapper.find('[data-testid="remove-service-image"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="undo-service-image"]').exists()).toBe(false)
  })

  it('ties the visible label to the file input, restricts the picker to jpeg/png/webp, and uses real buttons', () => {
    const wrapper = mountField(initialImageDraft(null))
    const input = wrapper.get('[data-testid="service-image-input"]')
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('accept')).toBe('image/jpeg,image/png,image/webp')
    expect(wrapper.get('[data-testid="pick-service-image"]').element.tagName).toBe('BUTTON')
    expect(wrapper.get('[data-testid="service-image-error"]').attributes('aria-live')).toBe('polite')
  })

  it('(1)→(2) selecting a file stages it with a local preview; undo returns to none and revokes it', async () => {
    const wrapper = mountField(initialImageDraft(null))
    const f = jpeg()
    await pick(wrapper, f)

    expect(state(wrapper)).toBe('staged')
    expect(draft(wrapper)).toMatchObject({ kind: 'staged', file: f })
    const img = wrapper.get('[data-testid="service-image-preview"]')
    expect(img.attributes('src')).toBe('blob:preview-1')
    expect(img.attributes('alt')).toBe('کوتاهی مو')

    await wrapper.get('[data-testid="undo-service-image"]').trigger('click')
    expect(state(wrapper)).toBe('none')
    expect(revoked).toEqual(['blob:preview-1'])
  })

  it('(3) an existing image shows the saved url with change and remove actions', () => {
    const wrapper = mountField(initialImageDraft('http://localhost:3002/uploads/s.jpg'))
    expect(state(wrapper)).toBe('existing')
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe('http://localhost:3002/uploads/s.jpg')
    expect(wrapper.get('[data-testid="pick-service-image"]').text()).toContain('تغییر تصویر')
    expect(wrapper.find('[data-testid="remove-service-image"]').exists()).toBe(true)
    expect(created).toEqual([])
  })

  it('(3)→(4)→(3) replacing previews the new file, and undo goes back to the saved image', async () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'))
    await pick(wrapper, jpeg())

    expect(state(wrapper)).toBe('replacing')
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe('blob:preview-1')
    expect(wrapper.get('[data-testid="undo-service-image"]').text()).toContain('بازگشت به تصویر فعلی')

    await wrapper.get('[data-testid="undo-service-image"]').trigger('click')
    expect(draft(wrapper)).toEqual({ kind: 'existing', url: '/uploads/s.jpg' })
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe('/uploads/s.jpg')
    expect(revoked).toEqual(['blob:preview-1'])
  })

  it('picking a second file revokes the first preview', async () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'))
    await pick(wrapper, jpeg())
    await pick(wrapper, jpeg(10, 'b.jpg'))
    expect(created).toEqual(['blob:preview-1', 'blob:preview-2'])
    expect(revoked).toEqual(['blob:preview-1'])
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe('blob:preview-2')
  })

  it('(3)→(5)→(3) marking for removal keeps the image visible as "will be removed", with undo', async () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'))
    await wrapper.get('[data-testid="remove-service-image"]').trigger('click')

    expect(state(wrapper)).toBe('removing')
    expect(wrapper.text()).toContain('حذف می‌شود')
    expect(wrapper.find('[data-testid="pick-service-image"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="undo-service-image"]').text()).toContain('بازگرداندن تصویر')

    await wrapper.get('[data-testid="undo-service-image"]').trigger('click')
    expect(draft(wrapper)).toEqual({ kind: 'existing', url: '/uploads/s.jpg' })
  })

  it('(6) a save failure written into the draft shows inline and keeps the staged file for retry', async () => {
    const f = jpeg()
    const wrapper = mountField({ kind: 'replacing', url: '/uploads/s.jpg', file: f, error: 'بارگذاری تصویر ناموفق بود؛ دوباره تلاش کنید.' })

    expect(wrapper.get('[data-testid="service-image-error"]').text()).toContain('بارگذاری تصویر ناموفق بود')
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe('blob:preview-1')
    expect(draft(wrapper)).toMatchObject({ file: f })
  })

  it('an empty selection (dismissed picker) never clears an existing image', async () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'))
    await pick(wrapper, null)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(state(wrapper)).toBe('existing')
  })

  it('rejects a non-image file client-side with a Persian error and leaves the draft untouched', async () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'))
    await pick(wrapper, new File(['x'], 'a.gif', { type: 'image/gif' }))
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.get('[data-testid="service-image-error"]').text()).toContain('فقط تصویر (jpeg, png, webp) مجاز است.')
    expect(state(wrapper)).toBe('existing')
  })

  it('rejects a file over 5 MB client-side, and a later valid pick clears the error', async () => {
    const wrapper = mountField(initialImageDraft(null))
    await pick(wrapper, jpeg(5 * 1024 * 1024 + 1))
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.get('[data-testid="service-image-error"]').text()).toContain('حجم تصویر باید کمتر از ۵ مگابایت باشد.')

    await pick(wrapper, jpeg())
    expect(state(wrapper)).toBe('staged')
    expect(wrapper.get('[data-testid="service-image-error"]').text()).toBe('')
  })

  it('busy: shows the in-progress state and disables every action', () => {
    const wrapper = mountField({ kind: 'staged', file: jpeg(), error: '' }, { busy: true })
    expect(wrapper.get('[data-testid="service-image-status"]').text()).toBe('در حال بارگذاری…')
    for (const testid of ['pick-service-image', 'undo-service-image']) {
      expect((wrapper.get(`[data-testid="${testid}"]`).element as HTMLButtonElement).disabled).toBe(true)
    }
    expect((wrapper.get('[data-testid="service-image-input"]').element as HTMLInputElement).disabled).toBe(true)
  })

  it('a parent resetting the draft (save succeeded / cancel) revokes the staged preview', async () => {
    const wrapper = mountField({ kind: 'staged', file: jpeg(), error: '' })
    await wrapper.setProps({ modelValue: initialImageDraft('/uploads/new.jpg') })
    expect(revoked).toEqual(['blob:preview-1'])
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('src')).toBe('/uploads/new.jpg')
  })

  it('revokes the preview on unmount', () => {
    const wrapper = mountField({ kind: 'staged', file: jpeg(), error: '' })
    wrapper.unmount()
    expect(revoked).toEqual(['blob:preview-1'])
  })

  it('a rejected pick error is cleared when the parent resets the draft (cancel / save / form reset)', async () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'))
    await pick(wrapper, new File(['x'], 'a.gif', { type: 'image/gif' }))
    expect(wrapper.get('[data-testid="service-image-error"]').text()).toContain('فقط تصویر')
    // The parent replaces the draft (a row «انصراف», a successful save, the add form's reset).
    await wrapper.setProps({ modelValue: initialImageDraft('/uploads/s.jpg') })
    expect(wrapper.get('[data-testid="service-image-error"]').text()).toBe('')
  })

  it('picking the very same File twice keeps exactly one live preview', async () => {
    const wrapper = mountField(initialImageDraft(null))
    const f = jpeg()
    await pick(wrapper, f)
    await pick(wrapper, f)
    expect(state(wrapper)).toBe('staged')
    expect(created.length - revoked.length).toBe(1)
    wrapper.unmount()
    expect(created.length).toBe(revoked.length)
  })

  it('falls back to a generic alt text while the service has no name yet', () => {
    const wrapper = mountField(initialImageDraft('/uploads/s.jpg'), { serviceName: '  ' })
    expect(wrapper.get('[data-testid="service-image-preview"]').attributes('alt')).toBe('تصویر خدمت')
  })
})
