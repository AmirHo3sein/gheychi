import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  storySeenKey,
  newestStoryCreatedAt,
  hasUnseenStories,
  readStorySeen,
  recordStorySeen,
} from '../../app/utils/story-seen'

const T1 = '2026-07-17T08:00:00.000Z'
const T2 = '2026-07-17T10:00:00.000Z'
const T3 = '2026-07-17T12:00:00.000Z'

describe('newestStoryCreatedAt', () => {
  it('returns null for no stories', () => {
    expect(newestStoryCreatedAt([])).toBeNull()
  })

  it('finds the newest createdAt regardless of order', () => {
    expect(newestStoryCreatedAt([{ createdAt: T2 }, { createdAt: T3 }, { createdAt: T1 }])).toBe(T3)
  })
})

describe('hasUnseenStories', () => {
  it('is false when there are no stories at all', () => {
    expect(hasUnseenStories(null, null)).toBe(false)
    expect(hasUnseenStories(T1, null)).toBe(false)
  })

  it('is true when nothing has ever been seen', () => {
    expect(hasUnseenStories(null, T1)).toBe(true)
  })

  it('is true only when a story is strictly newer than the seen-state', () => {
    expect(hasUnseenStories(T1, T2)).toBe(true)
    expect(hasUnseenStories(T2, T2)).toBe(false) // seen == newest -> ring dims
    expect(hasUnseenStories(T3, T2)).toBe(false)
  })
})

describe('localStorage-backed read/record', () => {
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads back what was recorded, keyed per salon', () => {
    recordStorySeen('salon-a', T1)
    recordStorySeen('salon-b', T2)
    expect(readStorySeen('salon-a')).toBe(T1)
    expect(readStorySeen('salon-b')).toBe(T2)
    expect(store[storySeenKey('salon-a')]).toBe(T1)
  })

  it('returns null when nothing was recorded', () => {
    expect(readStorySeen('salon-a')).toBeNull()
  })

  it('only advances the seen-state, never rewinding it', () => {
    recordStorySeen('salon-a', T2)
    recordStorySeen('salon-a', T1) // older -- ignored
    expect(readStorySeen('salon-a')).toBe(T2)
    recordStorySeen('salon-a', T3)
    expect(readStorySeen('salon-a')).toBe(T3)
  })

  it('swallows storage failures instead of throwing (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(readStorySeen('salon-a')).toBeNull()
    expect(() => recordStorySeen('salon-a', T1)).not.toThrow()
  })
})
