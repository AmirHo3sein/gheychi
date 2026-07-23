---
target: apps/user-app/app/pages/bookings/index.vue + [id].vue
total_score: 12
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-23T15-43-44Z
slug: apps-user-app-app-pages-bookings-index-vue
---
Method: dual-agent (A: aa9b885954ff9055c · B: a92a604cfe3754394)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Cancel/retry-payment have no loading state on their triggering buttons |
| 2 | Match System / Real World | 3 | Persian labels correct throughout |
| 3 | User Control and Freedom | 2 | No cancel on detail page; only a native confirm() before an irreversible cancellation |
| 4 | Consistency and Standards | 1 | Both pages hand-roll markup; --color-ad (reserved for the ad badge) reused as a warning tint and a destructive-action color |
| 5 | Error Prevention | 1 | Cancel confirm() has zero mention of deposit/refund consequences |
| 6 | Recognition Rather Than Recall | 1 | Every booking status renders as identical plain text -- no color/icon differentiation |
| 7 | Flexibility and Efficiency | 1 | One flat list, no upcoming/history separation, no filter/sort |
| 8 | Aesthetic and Minimalist Design | 1 | Unstyled by omission, not restrained by intent -- no hierarchy anywhere |
| 9 | Error Recovery | 1 | Generic toast only, no loading-state reset since none exists |
| 10 | Help and Documentation | 0 | No refund-policy explanation anywhere despite PRODUCT.md naming it a real rule |
| **Total** | | **12/40** | **Poor** |

## Design Specificity Verdict

**LLM assessment:** Fails badly. Nothing in either file is authored for this product -- no seal-of-approval accent usage, no distinction between claimed and verified state, no typographic hierarchy. This is the exact page where the "Verified Ledger" trust claim should be most legible and instead it's the least designed screen sampled.

**Deterministic scan:** CLI detector clean on all files -- a confirmed false-negative, not evidence of cleanliness (reproduces the same known gap found on every prior page this session). Manual verification found: six separate emoji-as-icon star-rating instances in ReviewPromptModal.vue (undocumented by DESIGN.md, beyond its known migration-debt list), --color-ad misuse in two unrelated roles on bookings/index.vue, a self-documented WCAG failure (plain --color-accent as a white-text fill, 2.96:1), and a Container-Softer-Than-Control violation on the booking card radius.

## Overall Impression

This is where a customer manages a real financial commitment after the fact -- cancellation, refund status, post-visit review -- and it's the least designed, least system-compliant surface found in the whole sweep so far. The emotional peak-end moment (refund resolution) is the least reassuring, least visually distinct moment in the entire flow: "still pending" and "money is back" render in the identical color.

## What's Working

1. ReviewPromptModal's phase state machine (form/view/edit/deleted/already-reviewed) correctly handles the 409 already-reviewed edge case with an honest documented limitation, and is the one place in this flow that composes BaseCard/BaseButton.
2. The typed domain model (BookingItem/BookingDetail) already carries the full status union and refund state -- this is a presentation-layer gap, not a backend one.
3. Cookie/error handling discipline is sound -- both pages route through useApi() correctly.

## Priority Issues

**[P0] Cancellation has no refund/deposit information at the point of decision.** (bookings/index.vue) A bare native confirm('این نوبت لغو شود؟') with zero mention of the refund window or deposit forfeiture -- directly contradicts Product Principle #3.

**[P1] Both pages ignore the Base* design system entirely, including a wrong-token color violation.** --color-ad reused for a payment-warning tint and a cancel button, while --color-danger/-soft sit unused. Zero BaseCard/BaseButton usage on either page.

**[P1] No visual differentiation between booking statuses.** completed/confirmed/no_show/cancelled/expired all render as identical plain text -- a direct scanability failure on the app's own booking-management surface.

**[P1] Detail page has zero actions.** (bookings/[id].vue) A customer drilling into detail finds a read-only summary with no cancel/retry-payment/review, forcing a context switch back to the list for anything actionable.

**[P2] Refund status is illegible and incomplete.** (bookings/[id].vue) "Pending" and "completed" refund states both render in the same accent color despite --color-success existing precisely for this; refund status is also absent from the list entirely.

## Persona Red Flags

**Jordan (first-timer):** Cancels for the first time, hits a bare confirm() with no deposit mention -- no way to know if they're about to lose money.
**Casey (distracted mobile):** Taps retry-payment or cancel on a slow connection, gets zero visual feedback -- reads as a dead button.
**Sam (accessibility):** ReviewPromptModal's star-rating buttons are raw emoji with no aria-label; the modal itself has no role=dialog/aria-modal and no Escape handler.

## Minor Observations

bookings/[id].vue is missing the root v-if="page" guard that salons/[slug].vue and booking/[slug]/[serviceId].vue already carry for the documented Suspense pre-render crash on createError(404) paths -- reintroducing a bug already fixed elsewhere. Card radius uses the control scale (12px) instead of the container scale (16px). No upcoming/history section separation despite PRODUCT.md framing this page as "booking history/management." No text truncation on long salon names.

## Questions to Consider

- If a customer just parted with a real deposit, why does canceling it look and feel identical to dismissing a browser tab's confirm dialog?
- The detail page knows the exact deposit/refund breakdown -- so why can't the user act on any of it there?
- Why do the two pages guarding a customer's actual money get less documented design attention than the login screen and the homepage?
