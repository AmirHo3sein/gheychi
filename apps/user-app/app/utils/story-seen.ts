// Client-side story seen-state: the newest-seen story `createdAt` per salon, kept in
// localStorage only (spec decision: no server-side per-user seen state or view counts).
// Self-expiring by design -- once a salon's stories all expire, the stored timestamp simply
// stops being newer than anything; no pruning logic needed.

const KEY_PREFIX = 'story-seen:'

export function storySeenKey(salonId: string): string {
  return `${KEY_PREFIX}${salonId}`
}

/** Newest `createdAt` among the given stories, or null when there are none. */
export function newestStoryCreatedAt(stories: { createdAt: string }[]): string | null {
  let newest: string | null = null
  for (const story of stories) {
    if (newest === null || Date.parse(story.createdAt) > Date.parse(newest)) {
      newest = story.createdAt
    }
  }
  return newest
}

/**
 * True when the salon has a story newer than the recorded seen-state -- the ring stays
 * bright. Dims (false) once the seen-state is at least as new as the newest story.
 */
export function hasUnseenStories(lastSeen: string | null, newest: string | null): boolean {
  if (newest === null) return false
  if (lastSeen === null) return true
  return Date.parse(newest) > Date.parse(lastSeen)
}

/** Recorded seen-state for a salon, or null when absent (or localStorage is unavailable). */
export function readStorySeen(salonId: string): string | null {
  try {
    return localStorage.getItem(storySeenKey(salonId))
  } catch {
    return null
  }
}

/** Advances the recorded seen-state, never rewinding it (stories play oldest-first). */
export function recordStorySeen(salonId: string, createdAt: string): void {
  try {
    const current = localStorage.getItem(storySeenKey(salonId))
    if (current !== null && Date.parse(current) >= Date.parse(createdAt)) return
    localStorage.setItem(storySeenKey(salonId), createdAt)
  } catch {
    // Private mode / quota errors -- seen-state is a nicety, losing it is harmless.
  }
}
