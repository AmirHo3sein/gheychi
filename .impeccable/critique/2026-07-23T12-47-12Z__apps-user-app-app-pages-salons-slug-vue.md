---
target: apps/user-app/app/pages/salons/[slug].vue
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-07-23T12-47-12Z
slug: apps-user-app-app-pages-salons-slug-vue
---
Method: dual-agent (A: a5158f08c13b17bf4 · B: a30dc919bd027c0e7)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Favorite state pops in silently, no busy indicator |
| 2 | Match System / Real World | 3 | Struck-through original price missing "تومان" unit that the final price has |
| 3 | User Control and Freedom | 3 | No major traps; lightbox/story-viewer close paths work well |
| 4 | Consistency and Standards | 1 | Zero Base* usage anywhere on this page's render tree; rounded-lg (banned 8px) repeated across every card-like row; accent color live on every price + story ring + booking pill simultaneously (One Seal Rule violated systemically) |
| 5 | Error Prevention | 2 | Empty services/hours render a bare header with nothing underneath -- the page's only path into booking, with no fallback |
| 6 | Recognition Rather Than Recall | 2 | Working hours list all 7 days with no "today/open now" highlight |
| 7 | Flexibility and Efficiency | 3 | Story/portfolio-tagged booking pills are a genuinely efficient deep-link shortcut |
| 8 | Aesthetic and Minimalist Design | 2 | No heading ever gets a size step -- nothing anchors a scan path |
| 9 | Error Recovery | 3 | ReportForm distinguishes 409/403/generic with specific copy; favorite-toggle failure relies only on the generic toast |
| 10 | Help and Documentation | 3 | Not complex enough to obviously need more |
| **Total** | | **25/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment:** Partially generic. Locale execution (Farsi weekday names, toman formatting, RTL-deliberate tap zones) is careful and specific. But the page is generic exactly where the product claims to be different: PRODUCT.md names verified-booking-only reviews, a real non-refundable deposit, and human-approved salons as the actual moat -- none of it is visible here. Strip the Farsi and this is any listings app's profile page.

**Deterministic scan:** CLI detector returned zero findings across all 8 files -- a confirmed structural false-negative, not a clean bill. Traced to source: the CLI's regex/text engine never resolves Tailwind utility classes (rounded-lg) to px values or checks emoji-as-icon-tile patterns; those checks exist only in the browser/HTML-DOM engine, unavailable this run (no connected Chrome extension, no Puppeteer installed). Source-verified findings used instead: `rounded-lg` (8px, explicitly banned) on the booking-CTA service row, the review card, and the team-member row; zero `shadow` usage anywhere on the render tree; zero hardcoded hex (all colors are token references); 6 distinct emoji-as-icon instances (⭐/♥/♡/✦/✕/🚩) across the page and 4 of its components.

**Visual overlays:** Not available this run (no connected browser tool, no Puppeteer). A real salon was seeded live through the running app (create → approve) and confirmed reachable via SSR curl, so the source-level findings reflect what actually ships, not just the source file -- but no screenshots exist for this pass.

## Overall Impression

This is the actual trust-decision screen -- the page whose entire job is converting a browse into a real deposit -- and it currently builds desire (the story ring, lightbox portfolio, and booking pills feel modern and Instagram-native) without building trust (none of the product's verification mechanisms are surfaced here at all). It also visually clashes with the freshly-redesigned login/Base* baseline, landed in this same session after this page's code.

## What's Working

1. **Service-linked story/portfolio booking pills** -- tagging ephemeral/portfolio content with a specific bookable service and deep-linking straight into booking is a thoughtful, high-intent conversion path.
2. **Real engineering care in the details** -- 24h story-TTL/seen-state handling, deliberate physical (not logical) RTL tap zones with an explanatory comment, scroll-lock lifecycle, JSON-LD escaping against script-tag injection from provider-authored names.
3. **Performance discipline matching the stated constraint** -- all gallery/portfolio images are lazy-loaded with explicit dimensions.

## Priority Issues

**[P0] The trust page shows no trust signals.** No verified-booking mark on reviews, no salon-approval badge, no deposit mention anywhere -- it only appears two screens deeper in the booking flow. Directly contradicts DESIGN.md's "Verified Ledger" north star and PRODUCT.md's stated differentiator, invisible at the exact screen built to convert. → add a verified-booking mark per review, an approval indicator near the header, a one-line deposit disclosure near services.

**[P1] Page and its components bypass the Base* system pervasively.** Zero Base* usage anywhere in the render tree; rounded-lg (banned) repeated on every card-like row; accent color live on every price + the story ring + every booking pill at once (systemic One Seal Rule violation). → migrate onto BaseCard/BaseButton/BaseIcon, reserve accent for one element per view.

**[P1] No location/map on the salon's own profile.** SalonMap.client.vue (Leaflet + CARTO + Neshan/Google directions) exists fully built but is only wired into index.vue's map toggle -- this page shows a plain text address. "Can I get there" is the most concrete trust question at this decision point. → add a single-pin map + directions CTA reusing the existing deep-link pattern.

**[P2] Missing currency unit + no empty-state for zero services/hours.** The struck-through original price is missing "تومان" (the final price has it); an empty services/hours array renders a bare header with nothing underneath, and services is the page's only path into booking -- a silent dead end.

**[P3] Flat header hierarchy + empty alt text on content photography.** Every section heading is bare font-bold with no size step; gallery/story/portfolio images all pass alt="" on the salon's actual photos -- the page's core visual evidence is invisible to screen readers.

## Persona Red Flags

**Jordan (first-timer):** Nothing distinguishes "vetted marketplace listing" from "random business page" -- the exact gap the trust mechanism should close. No map to sanity-check an unfamiliar address.
**Riley (stress-tester):** An approved-but-serviceless salon shows a header with nothing under it and zero explanation -- no path to book, no error message.
**Sam (accessibility):** All photography carries alt="", silencing a screen reader through the page's core evidence; 6 emoji glyphs stand in for functional icons instead of BaseIcon's aria-hidden SVGs.

## Minor Observations

Discount badge uses --color-danger/-soft for a positive promotional signal, while DESIGN.md reserves the Ad tokens for exactly this kind of commercial signaling. Favorite button is under a comfortable ~44px touch target on a budget-Android-targeted page. No sticky/persistent booking affordance on a long single-column page.

## Questions to Consider

- If verified-booking reviews are the product's actual moat, why does the one page converting a browse into a deposit never say so anywhere a customer would notice?
- This session's redesign shipped login.vue and the full Base* library but never touched this page or its four showcase components, and DESIGN.md's migration list doesn't name them either -- sequencing choice, or a gap in the migration list itself?
- SalonMap.client.vue already has Neshan/Google directions fully built -- why does the page where "can I get there" matters most show only a text string?
