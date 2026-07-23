---
target: apps/user-app/app/pages/index.vue
total_score: 13
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-07-23T10-25-33Z
slug: apps-user-app-app-pages-index-vue
---
Method: dual-agent (A: a539a0bc6c84e7494 · B: a0fb5ef5b7e405b53)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Search failures silently render as "no results" (silent: true swallows errors); no loading skeleton |
| 2 | Match System / Real World | 3 | Persian/toman conventions solid; fetched category icons never rendered |
| 3 | User Control and Freedom | 1 | No clear-filters, no retry, no way to re-request denied geolocation |
| 4 | Consistency and Standards | 0 | Raw `<select>` with banned rounded-lg (8px, detector-confirmed 8px computed), accent on 2+ simultaneous elements (One Seal Rule breach), emoji star icon where BaseIcon exists |
| 5 | Error Prevention | 1 | Search errors actively hidden rather than prevented or surfaced |
| 6 | Recognition Rather Than Recall | 3 | Active city/filter always visible; category icons unused |
| 7 | Flexibility and Efficiency | 1 | `sort` state fully wired to the API and never exposed in the template — dead feature |
| 8 | Aesthetic and Minimalist Design | 1 | Reads as unfinished, not restrained — no heading, no shadow/border vocabulary anywhere |
| 9 | Error Recovery | 0 | No error state exists; failure is indistinguishable from genuine emptiness |
| 10 | Help and Documentation | 1 | No cue explaining the "تبلیغ" (ad) badge; low-need screen so not scored 0 |
| **Total** | | **13/40** | **Poor** |

## Design Specificity Verdict

**LLM assessment:** Not product-specific. The city-select → filter-chips → list/map-toggle → card-list shape is a generic local-listings template; nothing visually signals "trust-first Iranian salon marketplace" beyond copy. DESIGN.md's own identity (accent as a rare seal, restrained shadow-as-elevation, "stamped receipt" precision) is absent here — the accent appears on 2+ simultaneous elements at all times, no shadow/border vocabulary is applied to any container, and no verification cue appears anywhere despite this being the screen directly upstream of the product's core differentiator.

**Deterministic scan:** CLI `detect.mjs` was clean on `index.vue` and `SalonMap.client.vue` (exit 0), but flagged `SalonCard.vue:14` — a `text-[0.65rem]` ad-badge size genuinely off DESIGN.md's 5-step type ramp (advisory). The CLI scanner cannot compute rendered contrast; the injected browser-runtime detector, run against the real authenticated page, found 2 genuine WCAG AA contrast failures (white text on `#0EA89B` accent = 3.0:1, needs 4.5:1 at that size/weight) on the "همه" and "لیست" buttons, plus one false positive (`single-font` flagged as an anti-pattern, but DESIGN.md explicitly names single-typeface as a deliberate rule — not a defect).

**Visual overlays:** Not left running in the browser (evidence collected, live-server stopped after capture) — see the console findings and computed-style table below instead. Screenshots saved (desktop/mobile × light/dark) at `.../scratchpad/critique-index-*.png`.

## Overall Impression

`index.vue` is the app's actual most-seen screen — the first thing every logged-in customer sees, every session — and it currently looks like it predates the design system entirely, because it does. The single biggest opportunity: this screen is directly upstream of the product's whole trust-verification pitch, and today it builds zero trust and, worse, actively lies about search failures by rendering them identically to "no salons here."

## What's Working

1. **RTL logical positioning in `SalonCard.vue`** — the featured badge correctly uses `top-2 start-2`, not hardcoded `left`/`right`, one of the easiest things to get wrong in an RTL-only system.
2. **The story-ring cue** (`ring-2 ring-(--color-accent)` on a salon thumbnail with an active story) is a smart, cheap, single-color signal that behaves exactly like DESIGN.md's restrained "seal" — the one place on this page that actually matches the documented system.
3. **Geolocation fallback logic is functionally resilient** — both the error and unavailable branches fall through to the default city rather than blocking or crashing the page.

## Priority Issues

**[P0] Search failures render identically to "no results found"**
- **Why it matters:** `apiFetch('/search', { silent: true })` swallows any network/server error; the template shows the exact same empty-state copy either way. On the trust-positioned product's first real screen, a transient failure tells the user, falsely, that the marketplace has nothing for them.
- **Fix:** Track a distinct error state; stop silencing this specific call; render a retry affordance on genuine failure.
- **Suggested command:** `/impeccable harden`

**[P0] Zero design-system compliance on the most-seen screen**
- **Why it matters:** DESIGN.md already names this file as the largest gap in the app. Detector-confirmed: the city `<select>` computes to an 8px radius (the explicitly banned `rounded-lg`) with border-color falling back to `currentColor` (no `colors.border` token at all — the border isn't just the wrong token, it's unstyled). The accent color is live on 2+ simultaneous elements at all times (One Seal Rule breach, browser-confirmed via the contrast findings on both). No heading exists anywhere on the page (confirmed both by source read and DOM query). `SalonCard.vue` uses an emoji star where `BaseIcon`'s `star` already exists.
- **Fix:** Migrate to `BaseSelect`/`BaseButton`/`BaseCard`, add a Title-level heading, collapse accent usage to one element, apply `rounded.md`/`rounded.lg` per the Container-Softer-Than-Control rule, fix the two WCAG AA contrast failures.
- **Suggested command:** `/impeccable polish` (or a dedicated migration pass)

**[P1] Two confirmed WCAG AA contrast failures**
- **Why it matters:** White text on the `#0EA89B` accent computes to 3.0:1 (needs 4.5:1 at 14px/400) on both the active category chip and the list/map toggle — reproducible via the browser runtime detector, not a static-scan guess.
- **Fix:** Either darken the accent for this specific text-on-fill pairing or increase weight/size past the large-text exemption threshold.
- **Suggested command:** `/impeccable harden`

**[P1] `sort` is fully wired end-to-end and has no UI control**
- **Why it matters:** State, API query param, and a watcher all exist (`index.vue`); no template element ever sets it. A real feature was built and never exposed — will read as a bug the moment it's tested.
- **Fix:** Add a two-option distance/rating sort toggle bound to the existing ref.
- **Suggested command:** `/impeccable clarify` or direct implementation

**[P1] No request-sequencing guard on `loadSalons()`**
- **Why it matters:** Rapid successive filter changes (a real mobile-tap pattern) can let an earlier, slower response overwrite a later one, silently showing results for a filter the user no longer has selected.
- **Fix:** Guard with an AbortController or request-id check; discard stale responses.

**[P2] Unprimed geolocation prompt + sub-44px touch targets**
- **Why it matters:** A cold OS permission dialog with zero lead-in copy erodes trust before context is given; category/view chips at `py-1` (~28px) sit well under the ~44px mobile tap-target guidance, risking mis-taps for a one-handed, distracted, budget-Android user — exactly this product's documented primary usage context.
- **Fix:** Add brief priming copy or an explicit "near me" opt-in before the permission request; bump chip padding to `py-2`/`min-h-11`.

## Persona Red Flags

**Jordan (first-timer):** No heading explains this screen or why a city is pre-selected. The "تبلیغ" badge is unexplained. A cold geolocation prompt with no lead-in is likely to get reflexively denied, permanently stranding Jordan on the default city with no visible fix.

**Riley (stress tester):** Toggling network off mid-search produces the identical "no results" message as a real empty state (P0). Rapid category/city changes can trigger the stale-response race (P1) with no visible symptom. `sort=rating` is a live, working API param with no UI path to ever trigger it.

**Casey (distracted mobile user):** Sub-44px chip targets risk mis-taps on the move. The horizontally-scrolling category row has no scroll affordance (no fade/arrow), so off-screen categories may go unnoticed. Loading state is small centered text with no skeleton — easy to miss on a quick glance.

## Minor Observations

- `/categories` is fetched without `silent: true` while `/search` is silent — an inconsistent error-visibility policy across two calls on the same page load.
- `loadCoordsForMap()` is a documented, deliberate N+1 (one request per visible card for map view) — a known tradeoff, will worsen on slow networks as result counts grow.
- `ThemeToggle.vue` (rendered on every page via the shared header) still uses ☀️/🌙/💻 emoji where `BaseIcon`'s `sun`/`moon` icons already exist — the same migration gap DESIGN.md names.
- `AppHeader.vue` has no icon-badge wordmark treatment (`login.vue`'s established reference pattern) — bare text logo only.

## Questions to Consider

- If DESIGN.md already names this exact file as the largest compliance gap, and it's the most-seen screen for every logged-in customer — why is it still the unmigrated entry point to the whole booking funnel?
- The product's differentiator is *verified* trust, not claimed trust — so why does the one screen where a user decides whether to trust the marketplace at all carry zero verification signal, when the mechanism (the story-ring pattern) already exists and is already partially wired into `SalonCard`?
- `sort` was clearly meant to ship. What happened between building that logic and wiring a control to it — and does that same gap exist anywhere else in the app?
