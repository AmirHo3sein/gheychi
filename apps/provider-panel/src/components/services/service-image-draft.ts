// Pure state model for a service's one optional image, kept apart from the component so
// every transition is a plain function the spec can pin without mounting anything.
//
// The draft never holds an object URL: a preview URL is a browser resource that has to be
// revoked, and the same staged File can move between two ServiceImageField instances (the
// add form hands a failed upload over to the new service's row) -- each instance makes and
// revokes its own preview for whatever File the draft currently holds.

export type ServiceImageDraft =
  /** (1) No image, nothing staged. */
  | { kind: 'none' }
  /** (2) A new file chosen for a service that has no image yet, not saved. */
  | { kind: 'staged'; file: File; error: string }
  /** (3) The saved image, untouched. */
  | { kind: 'existing'; url: string }
  /** (4) The saved image, with a new file chosen to replace it (undo goes back to (3)). */
  | { kind: 'replacing'; url: string; file: File; error: string }
  /** (5) The saved image, marked for removal on the next save (undo goes back to (3)). */
  | { kind: 'removing'; url: string; error: string }
// (6) "save failed" is not a separate kind: it is (2)/(4)/(5) with a non-empty `error`,
// which keeps the staged file (or the removal intent) in place for a retry.

export type ServiceImageAction = 'upload' | 'delete' | null

// Mirrors the API's FileInterceptor limit (5 MB) and its jpeg/png/webp type validator --
// the same values PhotoUploader.vue checks. The server stays the authority (it also rejects
// undecodable files and anything under 200px); this only saves a doomed round trip.
export const SERVICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const SERVICE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp'
export const SERVICE_IMAGE_TYPE_ERROR = 'فقط تصویر (jpeg, png, webp) مجاز است.'
export const SERVICE_IMAGE_SIZE_ERROR = 'حجم تصویر باید کمتر از ۵ مگابایت باشد.'

export function validateServiceImageFile(file: File): string {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return SERVICE_IMAGE_TYPE_ERROR
  if (file.size > SERVICE_IMAGE_MAX_BYTES) return SERVICE_IMAGE_SIZE_ERROR
  return ''
}

/** The draft for a persisted service (or a blank form when `url` is null). */
export function initialImageDraft(url: string | null | undefined): ServiceImageDraft {
  return url ? { kind: 'existing', url } : { kind: 'none' }
}

/** The saved image this draft started from, if any. */
export function savedImageUrl(draft: ServiceImageDraft): string | null {
  return draft.kind === 'existing' || draft.kind === 'replacing' || draft.kind === 'removing' ? draft.url : null
}

export function stagedImageFile(draft: ServiceImageDraft): File | null {
  return draft.kind === 'staged' || draft.kind === 'replacing' ? draft.file : null
}

/** Choosing a file: staged when there is no saved image, replacing when there is one. */
export function selectImageFile(draft: ServiceImageDraft, file: File): ServiceImageDraft {
  const url = savedImageUrl(draft)
  return url ? { kind: 'replacing', url, file, error: '' } : { kind: 'staged', file, error: '' }
}

/** Only a saved image can be marked for removal; anything else is returned unchanged. */
export function markImageForRemoval(draft: ServiceImageDraft): ServiceImageDraft {
  return draft.kind === 'existing' ? { kind: 'removing', url: draft.url, error: '' } : draft
}

/** Drops any staged change: back to the saved image, or to no image at all. */
export function undoImageChange(draft: ServiceImageDraft): ServiceImageDraft {
  return initialImageDraft(savedImageUrl(draft))
}

/** What the next save has to send for this draft. */
export function pendingImageAction(draft: ServiceImageDraft): ServiceImageAction {
  if (draft.kind === 'staged' || draft.kind === 'replacing') return 'upload'
  if (draft.kind === 'removing') return 'delete'
  return null
}

/** Records a failed save on a pending draft (a draft with nothing pending has nothing to fail). */
export function withImageError(draft: ServiceImageDraft, error: string): ServiceImageDraft {
  if (draft.kind === 'none' || draft.kind === 'existing') return draft
  return { ...draft, error }
}

export function imageDraftError(draft: ServiceImageDraft): string {
  return draft.kind === 'none' || draft.kind === 'existing' ? '' : draft.error
}
