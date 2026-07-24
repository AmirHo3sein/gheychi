---
target: apps/user-app/app/pages/blog/index.vue + [slug].vue
total_score: 22
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 3
timestamp: 2026-07-24T06-52-10Z
slug: apps-user-app-app-pages-blog-index-vue
---
Method: dual-agent (A: a2c216519e885dd35 · B: abd4a9991a815f630)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Category/pagination clicks trigger a refetch with zero loading feedback |
| 2 | Match System / Real World | 4 | Fully natural Persian, fa-IR dates, plain-language empty state |
| 3 | User Control and Freedom | 3 | Filter/page state lives in the URL, shareable, correct back/forward |
| 4 | Consistency and Standards | 1 | Wholesale departure from Base*; reintroduced contrast-unsafe accent-as-fill already fixed elsewhere |
| 5 | Error Prevention | 3 | Pagination bounds-checked; nothing destructive on this surface |
| 6 | Recognition Rather Than Recall | 4 | All filter/pagination state always visible |
| 7 | Flexibility and Efficiency | n/a | Persuade/Read surface, no power-user expectation applies |
| 8 | Aesthetic and Minimalist Design | 2 | No max-width wrapper on index.vue -- 2-column grid stretches edge-to-edge on desktop |
| 9 | Error Recovery | 3 | Empty state is calm but offers no inline clear-filter action |
| 10 | Help and Documentation | n/a | Content-marketing surface, no contextual help expected |
| **Total** | | **22/32** | **Acceptable (69%)** |

## Design Specificity Verdict

**LLM assessment:** Category-interchangeable. Strip the Persian copy and this could be dropped into any blog/CMS starter -- generic pill filters, generic un-bordered cards, generic pager. No brand mark, no "seal of approval" restraint, no tie back to the Verified Ledger trust language. The article typography itself shows real product-specific care (RTL-native, logical properties, LTR code islands) but nothing bridges back to salons/bookings/trust -- the one thing PRODUCT.md says this surface exists to do.

**Deterministic scan:** CLI detector clean on index.vue (confirmed false-negative -- manual verification found a real light-mode contrast failure on the selected chip and a card missing its border/shadow), and caught 4 real findings on [slug].vue (a blockquote side-border flagged as an AI-slop tell, two off-ramp markdown heading sizes, an off-scale inline-code radius). Manual verification additionally found the same plain-accent-as-fill contrast bug already fixed elsewhere in the app (2.96:1 light), and a second contrast failure on category-label text in BOTH modes (2.96:1 light / 3.02:1 dark).

## Overall Impression

The reading experience itself is comfortable and the SEO/security engineering underneath is unusually solid (JSON-LD escaping, canonical/OG tags, single-fetch idiom) -- but the surface fails its one stated job. A reader who finishes an article, the highest-engagement moment this surface will ever produce, has nowhere to go but back to Google. That's the single biggest strategic gap found in this whole sweep.

## What's Working

1. RTL-native markdown typography -- logical properties throughout, explicit LTR code islands, Persian ordered-list numerals. Real, non-generic craft.
2. Rigorous invisible SEO layer -- canonical link, full OG tags, JSON-LD Article schema with documented `<` escaping, a layered description fallback chain, html:false markdown with a pinned invariant test.
3. URL-driven filter/pagination state, fully shareable/bookmarkable, single-fetch idiom, correct back/forward.

## Priority Issues

**[P1] Category/pagination clicks give zero loading feedback.** Both useAsyncData calls destructure only `data`, never `pending`/`status` -- on a slow-network tap the UI just sits still, reading as broken on the exact hardware this product targets.

**[P1] Blog pages sit entirely outside the Base* system, including a reintroduced contrast-unsafe color pairing.** Selected chip fill and category-label text both reuse the already-fixed-elsewhere unsafe accent pairing; post cards use the control radius with no border/shadow.

**[P1] index.vue has no max-width container; [slug].vue does.** The 2-column grid stretches edge-to-edge on any non-mobile viewport.

**[P2] The article page has no bridge back to the product's actual conversion goal.** No related posts, no return-to-blog link even, and critically no CTA toward salon search/discovery anywhere -- directly contradicting this surface's stated purpose.

**[P3] Article body markdown can emit a duplicate/mis-leveled H1** if an author's body starts with `# ` -- hurts both SEO and screen-reader navigation.

## Persona Red Flags

**Jordan (organic-search first-timer):** Finishes an article and finds no invitation to explore the product -- the only outbound link goes to more blog content, never to salon search. Will bounce.
**Casey (budget Android, this app's documented primary persona):** Taps a filter/pagination control on a slow connection, no spinner, no disabled state -- doesn't know the tap registered. Chips/pagination are also well under 44px.
**Sam (accessibility):** Selected chip's white-on-accent text is 2.96:1, fails AA -- can't reliably tell which category is active. A duplicate H1 breaks heading-jump navigation.

## Minor Observations

Missing-cover-image placeholder is a blank rectangle with no icon. The horizontally-scrollable category row has no scroll affordance. No inline "clear filter" action on the zero-results empty state.

## Questions to Consider

- If this is the app's literal SEO front door, why is it the one surface that never got the Base* treatment?
- What does "trust" mean on a page with zero connection to bookings, reviews, or salons -- should every article structurally end with a bridge back to that story?
- Is a flat, unbounded 2-column grid the right shape for cold organic-search traffic, or would a single featured post plus a tighter list better match the system's "one primary thing per screen" discipline?
