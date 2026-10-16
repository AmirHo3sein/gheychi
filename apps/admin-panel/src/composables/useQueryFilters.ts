// apps/admin-panel/src/composables/useQueryFilters.ts
import { inject, ref, watch, type Ref } from 'vue'
import { routeLocationKey, routerKey, type LocationQuery, type LocationQueryRaw } from 'vue-router'

type FilterValue = string | number
type FilterRefs<T extends Record<string, FilterValue>> = { [K in keyof T]: Ref<T[K]> }
type QueryFilters<T extends Record<string, FilterValue>> = FilterRefs<T> & {
  /**
   * True while every filter still holds exactly what the URL last put there -- i.e. the change
   * a page's filter watcher is reacting to came from a navigation (back/forward, a same-path
   * link), not from the admin editing a filter. A page's "a filter changed, so go back to
   * page 1" rule must skip that case: a URL that moves a filter AND `page` together (back to
   * /salons?status=approved&page=3) has to land on page 3, not be reset like a fresh edit.
   */
  changedByUrl: () => boolean
}

interface Options<T> {
  /**
   * Accepted values per string key (a select's option values). A hand-edited or stale URL
   * carrying anything else falls back to the default instead of being sent to the API, where
   * the DTO's @IsIn would 400 the whole list. A RegExp checks a free-form shape (dates).
   */
  allowed?: Partial<Record<keyof T, readonly string[] | RegExp>>
}

/**
 * List-page filters that live in the URL query, so the back button (returning from a detail
 * page) restores them and a filtered view can be shared or deep-linked -- the dashboard's
 * «نیاز به رسیدگی» tiles link straight to e.g. /salons?status=pending.
 *
 * The same idea as BookingsView/ReviewsView reading `route.query` once on setup, made
 * two-way: each filter is a plain ref, initialised from the query; any change is written
 * back with `router.replace` (never `push` -- one history entry per keystroke would make
 * "back" step through every letter typed), and a query change while the page stays mounted
 * (clicking the page's own sidebar link, browser back/forward between two queries of the
 * same path) flows back into the refs. Default values are left out of the URL entirely, so
 * an unfiltered list keeps a clean `/salons`.
 *
 * Number defaults (e.g. `page: 1`) parse as positive integers; anything else falls back.
 * Without a router installed (component unit tests that mount a view bare) the refs simply
 * stay local -- `inject` with a null default, so no "injection not found" warning either.
 */
/** The JalaliDatePicker's model shape (a Gregorian ISO date). */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function useQueryFilters<T extends Record<string, FilterValue>>(defaults: T, options: Options<T> = {}): QueryFilters<T> {
  const router = inject(routerKey, null)
  const route = inject(routeLocationKey, null)
  const keys = Object.keys(defaults) as Array<keyof T & string>

  function parse<K extends keyof T & string>(key: K, raw: LocationQuery[string] | undefined): T[K] {
    const fallback = defaults[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value !== 'string' || value === '') return fallback
    if (typeof fallback === 'number') {
      const n = Number(value)
      return (Number.isInteger(n) && n >= 1 ? n : fallback) as T[K]
    }
    const allowed = options.allowed?.[key]
    if (allowed instanceof RegExp ? !allowed.test(value) : allowed && !allowed.includes(value)) return fallback
    return value as T[K]
  }

  const refs = Object.fromEntries(keys.map((key) => [key, ref(parse(key, route?.query[key]))])) as unknown as FilterRefs<T>
  // The values the URL last pushed INTO the refs (on setup, and whenever a navigation changed
  // one). Deliberately not refreshed by this composable's own router.replace echoes -- a
  // debounced text filter reacts after its own write has landed, and must still read as an
  // edit.
  let fromUrl: Record<string, FilterValue> = Object.fromEntries(keys.map((key) => [key, refs[key].value]))
  const changedByUrl = () => keys.every((key) => refs[key].value === fromUrl[key])
  const result = Object.assign(refs, { changedByUrl }) as QueryFilters<T>
  if (!router || !route) return result
  // The layout keys each page by path, so this instance belongs to exactly this path. During a
  // navigation away the outgoing page is still mounted (the route fade runs both at once) and
  // its watchers see the INCOMING route -- every sync below is gated on still being on ours.
  const ownPath = route.path

  function serialize(key: keyof T & string): string | undefined {
    const value = refs[key].value
    return value === defaults[key] || value === '' ? undefined : String(value)
  }

  watch(
    () => keys.map((key) => refs[key].value),
    () => {
      if (route.path !== ownPath) return
      // Foreign params (anything this page doesn't own) survive untouched.
      const next: LocationQueryRaw = { ...route.query }
      let changed = false
      for (const key of keys) {
        const want = serialize(key)
        const current = route.query[key]
        const have = Array.isArray(current) ? current[0] : current
        if ((have ?? undefined) !== want) changed = true
        if (want === undefined) delete next[key]
        else next[key] = want
      }
      if (changed) router.replace({ path: ownPath, query: next })
    },
  )

  watch(
    () => route.query,
    (query) => {
      if (route.path !== ownPath) return
      const parsed = Object.fromEntries(keys.map((key) => [key, parse(key, query[key])])) as unknown as T
      if (keys.every((key) => refs[key].value === parsed[key])) return
      fromUrl = parsed
      for (const key of keys) refs[key].value = parsed[key]
    },
  )

  return result
}
