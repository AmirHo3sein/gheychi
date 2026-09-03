import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './debounce'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs the function once, after the delay', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 300)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses a burst of calls into the last one -- the point of it on a search box', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 300)

    debounced('م')
    vi.advanceTimersByTime(100)
    debounced('مر')
    vi.advanceTimersByTime(100)
    debounced('مریم')
    vi.advanceTimersByTime(300)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('مریم')
  })
})
