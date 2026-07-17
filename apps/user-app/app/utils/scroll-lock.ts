// Body scroll lock for full-screen overlays (story viewer, portfolio lightbox).
// Client-only by nature -- callers invoke it from mounted hooks / click handlers.
//
// Locks BOTH documentElement and body: browsers disagree on which element is the
// scrolling box, and `overflow: hidden` on only one still lets the other scroll.
// The returned release function restores the exact prior inline values (which are
// usually '' -- restoring '' removes the inline override rather than pinning a
// value a stylesheet didn't set), and is idempotent so double-release is safe.

export function lockBodyScroll(): () => void {
  const root = document.documentElement
  const body = document.body
  const prevRoot = root.style.overflow
  const prevBody = body.style.overflow
  root.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    root.style.overflow = prevRoot
    body.style.overflow = prevBody
  }
}
