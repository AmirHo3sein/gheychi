import { describe, expect, it, vi } from 'vitest'
import { useToast } from './useToast'

describe('useToast', () => {
  it('pushes a message and auto-dismisses it after 5s', () => {
    vi.useFakeTimers()
    const { toasts, push } = useToast()
    const before = toasts.value.length

    push('hello')
    expect(toasts.value.length).toBe(before + 1)

    vi.advanceTimersByTime(5000)
    expect(toasts.value.length).toBe(before)
    vi.useRealTimers()
  })
})
