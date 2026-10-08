import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from './useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetToast()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes a message (info by default) and auto-dismisses it after 5s', () => {
    const { toasts, push } = useToast()

    push('hello')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].tone).toBe('info')

    vi.advanceTimersByTime(4999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('keeps a success toast for 4s', () => {
    const { toasts, push } = useToast()
    push('saved', 'success')
    vi.advanceTimersByTime(3999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('keeps an error toast for 8s', () => {
    const { toasts, push } = useToast()
    push('failed', 'error')
    vi.advanceTimersByTime(7999)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(toasts.value).toHaveLength(0)
  })

  it('dismisses a single toast on demand', () => {
    const { toasts, push, dismiss } = useToast()
    push('a')
    push('b')
    dismiss(toasts.value[0].id)
    expect(toasts.value.map((t) => t.message)).toEqual(['b'])
  })
})
