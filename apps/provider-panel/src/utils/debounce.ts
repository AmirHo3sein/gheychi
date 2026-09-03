// apps/provider-panel/src/utils/debounce.ts
// Same helper admin-panel already carries (apps/admin-panel/src/utils/debounce.ts), copied
// rather than shared: the two panels have no common package between them, and a five-line
// utility is not worth inventing one for.
export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: Args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delayMs)
  }
}
