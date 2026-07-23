// Shared dialog-a11y primitive for the app's hand-rolled `fixed inset-0` overlays
// (ReportForm, PortfolioGrid's lightbox, StoryViewer). It does NOT own markup or
// scroll-locking -- callers keep their own overlay markup and keep composing
// `lockBodyScroll()` from utils/scroll-lock.ts themselves. This composable only
// wires the behavioral a11y contract every dialog needs:
//
//   - focus moves into the dialog on mount (first focusable element, falling back
//     to the dialog root itself)
//   - Tab/Shift+Tab is trapped inside the dialog while it's open
//   - Escape invokes `onClose`
//   - focus is restored to whatever triggered the dialog when it unmounts
//
// Usage:
//   const dialogRoot = ref<HTMLElement | null>(null)
//   const { titleId } = useDialog(dialogRoot, { onClose: close })
//   <div ref="dialogRoot" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
//     <h2 :id="titleId">...</h2>
//
// `enabled` lets a dialog pause its own Escape/Tab handling while a second, nested
// dialog is mounted on top of it (e.g. StoryViewer/PortfolioGrid's lightbox while
// their embedded ReportForm is open) -- the nested dialog gets its own `useDialog`
// call and handles its own Escape/trap/focus-restore independently while mounted.
export interface UseDialogOptions {
  /** Called when Escape is pressed while this dialog is enabled. */
  onClose?: () => void
  /** Returns false to suspend Escape/Tab handling (a nested dialog is on top). Defaults to always-on. */
  enabled?: () => boolean
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialog(root: Ref<HTMLElement | null>, options: UseDialogOptions = {}) {
  const titleId = useId()
  const isEnabled = () => options.enabled?.() ?? true

  let active = false
  let previouslyFocused: HTMLElement | null = null

  function getFocusable(): HTMLElement[] {
    if (!root.value) return []
    return Array.from(root.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  }

  function focusFirst() {
    const first = getFocusable()[0]
    ;(first ?? root.value)?.focus()
  }

  function onKeydown(event: KeyboardEvent) {
    if (!isEnabled()) return

    if (event.key === 'Escape') {
      options.onClose?.()
      return
    }

    if (event.key !== 'Tab') return

    const items = getFocusable()
    if (items.length === 0) {
      // Nothing to trap focus between -- keep it pinned on the dialog root.
      event.preventDefault()
      root.value?.focus()
      return
    }

    const first = items[0]!
    const last = items[items.length - 1]!
    const activeEl = document.activeElement

    if (event.shiftKey) {
      if (activeEl === first || !root.value?.contains(activeEl)) {
        event.preventDefault()
        last.focus()
      }
    } else if (activeEl === last || !root.value?.contains(activeEl)) {
      event.preventDefault()
      first.focus()
    }
  }

  function activate() {
    if (active) return
    active = true
    previouslyFocused = document.activeElement as HTMLElement | null
    nextTick(() => {
      if (active) focusFirst()
    })
    window.addEventListener('keydown', onKeydown)
  }

  function deactivate() {
    if (!active) return
    active = false
    window.removeEventListener('keydown', onKeydown)
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus()
    }
    previouslyFocused = null
  }

  // Watching `root` (rather than this composable's own onMounted/onBeforeUnmount)
  // covers both retrofit shapes in this codebase: a dialog that is its own
  // component, mounted/unmounted via `v-if` at the call site (ReportForm,
  // StoryViewer -- `root` goes non-null exactly once, at mount), and a dialog
  // that is inline markup toggled by `v-if` *inside* an always-mounted parent
  // (PortfolioGrid's lightbox -- `root` can go null -> element -> null -> element
  // repeatedly across the parent's single lifetime). `flush: 'post'` guarantees
  // the DOM is already patched when we read `root.value`.
  watch(
    root,
    (el) => {
      if (el) activate()
      else deactivate()
    },
    { immediate: true, flush: 'post' },
  )

  // Safety net: if the component unmounts while `root` is still non-null (Vue
  // usually nulls it out first, but this guarantees the listener/focus-restore
  // cleanup runs regardless of that ordering).
  onBeforeUnmount(deactivate)

  return { titleId }
}
