import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from './useToast'

describe('useToast', () => {
  beforeEach(() => {
    resetToast()
    vi.useFakeTimers()
  })

  it('pushes a message onto the shared queue', () => {
    const { toasts, push } = useToast()
    push('چیزی اشتباه پیش رفت')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]!.message).toBe('چیزی اشتباه پیش رفت')
  })

  it('auto-dismisses a toast after 5 seconds', () => {
    const { toasts, push } = useToast()
    push('پیام موقت')
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(toasts.value).toHaveLength(0)
    vi.useRealTimers()
  })
})
