import { describe, expect, it } from 'vitest'
import {
  SERVICE_IMAGE_MAX_BYTES,
  SERVICE_IMAGE_SIZE_ERROR,
  SERVICE_IMAGE_TYPE_ERROR,
  imageDraftError,
  initialImageDraft,
  markImageForRemoval,
  pendingImageAction,
  selectImageFile,
  undoImageChange,
  validateServiceImageFile,
  withImageError,
} from './service-image-draft'

const file = (type = 'image/jpeg', size = 10) => new File([new Uint8Array(size)], 'a', { type })

describe('service-image-draft', () => {
  it('starts as none for a service without an image and existing for one with', () => {
    expect(initialImageDraft(null)).toEqual({ kind: 'none' })
    expect(initialImageDraft('/uploads/a.jpg')).toEqual({ kind: 'existing', url: '/uploads/a.jpg' })
  })

  it('stages a file when there is no saved image, and undo goes back to none', () => {
    const f = file()
    const staged = selectImageFile(initialImageDraft(null), f)
    expect(staged).toEqual({ kind: 'staged', file: f, error: '' })
    expect(pendingImageAction(staged)).toBe('upload')
    expect(undoImageChange(staged)).toEqual({ kind: 'none' })
  })

  it('replaces a saved image, keeping its url so undo restores it', () => {
    const f = file()
    const replacing = selectImageFile(initialImageDraft('/u.jpg'), f)
    expect(replacing).toEqual({ kind: 'replacing', url: '/u.jpg', file: f, error: '' })
    expect(pendingImageAction(replacing)).toBe('upload')
    expect(undoImageChange(replacing)).toEqual({ kind: 'existing', url: '/u.jpg' })
  })

  it('picking again while replacing or removing still targets the original saved image', () => {
    const f2 = file()
    expect(selectImageFile(selectImageFile(initialImageDraft('/u.jpg'), file()), f2)).toMatchObject({ kind: 'replacing', url: '/u.jpg', file: f2 })
    expect(selectImageFile(markImageForRemoval(initialImageDraft('/u.jpg')), f2)).toMatchObject({ kind: 'replacing', url: '/u.jpg' })
  })

  it('marks only a saved image for removal, and undo restores it', () => {
    const removing = markImageForRemoval(initialImageDraft('/u.jpg'))
    expect(removing).toEqual({ kind: 'removing', url: '/u.jpg', error: '' })
    expect(pendingImageAction(removing)).toBe('delete')
    expect(undoImageChange(removing)).toEqual({ kind: 'existing', url: '/u.jpg' })
    expect(markImageForRemoval(initialImageDraft(null))).toEqual({ kind: 'none' })
  })

  it('has nothing to send for none or an untouched existing image', () => {
    expect(pendingImageAction(initialImageDraft(null))).toBeNull()
    expect(pendingImageAction(initialImageDraft('/u.jpg'))).toBeNull()
  })

  it('records a save failure on a pending draft without dropping its file', () => {
    const f = file()
    const failed = withImageError(selectImageFile(initialImageDraft(null), f), 'خطا')
    expect(failed).toEqual({ kind: 'staged', file: f, error: 'خطا' })
    expect(imageDraftError(failed)).toBe('خطا')
    expect(pendingImageAction(failed)).toBe('upload')
    // Picking a new file clears the stale error.
    expect(imageDraftError(selectImageFile(failed, file()))).toBe('')
    // Nothing pending, nothing to fail.
    expect(withImageError(initialImageDraft('/u.jpg'), 'خطا')).toEqual({ kind: 'existing', url: '/u.jpg' })
  })

  it('validates type and the 5 MB limit like the API', () => {
    expect(validateServiceImageFile(file('image/png'))).toBe('')
    expect(validateServiceImageFile(file('image/webp'))).toBe('')
    expect(validateServiceImageFile(file('image/gif'))).toBe(SERVICE_IMAGE_TYPE_ERROR)
    expect(validateServiceImageFile(file('application/pdf'))).toBe(SERVICE_IMAGE_TYPE_ERROR)
    expect(validateServiceImageFile(file('image/jpeg', SERVICE_IMAGE_MAX_BYTES))).toBe('')
    expect(validateServiceImageFile(file('image/jpeg', SERVICE_IMAGE_MAX_BYTES + 1))).toBe(SERVICE_IMAGE_SIZE_ERROR)
  })
})
