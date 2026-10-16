// A worker's name is free text the salon owner typed when adding them, and owners in a hurry
// type placeholders: «عضو ۱», «کارمند 2», or just a number. Shown to a customer those read as
// a data leak («عضو ۱ / بدون امتیاز»), so they are replaced by a neutral «متخصص سالن» -- the
// honest thing we know about that person. A real name is always shown as typed.
const PLACEHOLDER = /^(?:عضو|کارمند|کارکن|پرسنل|همکار|متخصص|member|staff|worker|employee)?\s*[#\-_.]?\s*[0-9۰-۹٠-٩]*$/i

export const UNNAMED_WORKER_LABEL = 'متخصص سالن'

export function isPlaceholderWorkerName(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim()
  return trimmed === '' || PLACEHOLDER.test(trimmed)
}

/**
 * Display labels for a roster, keyed by worker id. When more than one worker is unnamed they
 * are numbered («متخصص سالن ۱», «متخصص سالن ۲») so a choice between them on the booking page
 * is still a choice between distinguishable buttons; a single unnamed worker is not numbered.
 */
export function workerDisplayLabels<T extends { id: string; name: string | null }>(workers: T[]): Record<string, string> {
  const unnamed = workers.filter((w) => isPlaceholderWorkerName(w.name))
  let n = 0
  return Object.fromEntries(
    workers.map((w) => {
      if (!isPlaceholderWorkerName(w.name)) return [w.id, w.name!.trim()]
      n += 1
      return [w.id, unnamed.length > 1 ? `${UNNAMED_WORKER_LABEL} ${n.toLocaleString('fa-IR')}` : UNNAMED_WORKER_LABEL]
    }),
  )
}

/** Single-name form, for places that show one worker (a booking's assigned staff member). */
export function workerDisplayName(name: string | null | undefined): string {
  return isPlaceholderWorkerName(name) ? UNNAMED_WORKER_LABEL : name!.trim()
}
