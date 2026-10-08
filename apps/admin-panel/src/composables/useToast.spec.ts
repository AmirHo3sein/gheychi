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

  it('defaults to the info tone so existing push(message) callers are unchanged', () => {
    const { toasts, push } = useToast()
    push('پیام')
    expect(toasts.value[0]!.tone).toBe('info')
  })

  it('keeps errors for 8 seconds and successes for 4', () => {
    const { toasts, push } = useToast()
    push('موفق', 'success')
    push('ناموفق', 'error')
    vi.advanceTimersByTime(3999)
    expect(toasts.value).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(toasts.value.map((t) => t.message)).toEqual(['ناموفق'])
    vi.advanceTimersByTime(3999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
    vi.useRealTimers()
  })

  it('dismisses a single toast on demand', () => {
    const { toasts, push, dismiss } = useToast()
    push('اول')
    push('دوم')
    dismiss(toasts.value[0]!.id)
    expect(toasts.value.map((t) => t.message)).toEqual(['دوم'])
    vi.useRealTimers()
  })
})
