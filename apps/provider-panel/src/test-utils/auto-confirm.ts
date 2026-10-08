import { watch } from 'vue'
import { useConfirm, type ConfirmOptions } from '@/composables/useConfirm'

/**
 * Test double for the ConfirmSheet host: answers every useConfirm() prompt immediately
 * (synchronously, so the awaiting code resumes on its next microtask) and records the
 * options it was asked with. Call `stop()` -- or let the test file end -- to detach.
 */
let active: (() => void) | null = null

export function autoConfirm(answer: boolean) {
  // Only one answerer at a time: a stale one from an earlier test would settle first.
  active?.()
  const { pending, settle } = useConfirm()
  const calls: ConfirmOptions[] = []
  const stop = watch(
    pending,
    (p) => {
      if (!p) return
      calls.push(p.options)
      settle(answer)
    },
    { flush: 'sync' },
  )
  active = stop
  return { calls, stop }
}
