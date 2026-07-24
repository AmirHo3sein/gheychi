---
target: apps/user-app/app/pages/profile.vue
total_score: 16
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 3
timestamp: 2026-07-23T18-21-16Z
slug: apps-user-app-app-pages-profile-vue
---
Method: dual-agent (A: a4ef7763b6771ff18 · B: ad8d2c340aadece6a)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | saveProfile() gives zero feedback -- no spinner, no success toast |
| 2 | Match System / Real World | 3 | Persian throughout, but raw English class-validator messages can leak into the toast on invalid name |
| 3 | User Control and Freedom | 3 | Nothing destructive commits without an explicit tap |
| 4 | Consistency and Standards | 1 | Zero Base* usage vs. fully-migrated sibling pages (wallet/referral); banned rounded-lg throughout |
| 5 | Error Prevention | 1 | No client-side guard matching the server's name-length constraint |
| 6 | Recognition Rather Than Recall | 2 | Name input has only a placeholder (vanishes once filled); gender select has no label at all |
| 7 | Flexibility and Efficiency | 2 | Native elements keyboard-operable by default, reasonable floor |
| 8 | Aesthetic and Minimalist Design | 2 | Accent color spread across 4 elements at once, diluting hierarchy |
| 9 | Error Recovery | 1 | Invalid-name error surfaces as a generic, non-field-proximate toast |
| 10 | Help and Documentation | n/a | Page is simple enough that a help affordance would be over-engineering |
| **Total** | | **16/36** | **Poor (44%)** |

## Design Specificity Verdict

**LLM assessment:** Not specific -- generic, and regressive relative to its own siblings. Zero Base* components anywhere. The tell: the two pages this file links to (account/wallet.vue, account/referral.vue), built the same session, are fully migrated -- stepping Profile to Wallet is a visible jump from an unstyled prototype into the actual design system.

**Deterministic scan:** CLI detector clean -- confirmed inconclusive (the file has no `<style>` block, exactly the blind spot already on record). Manual verification found: rounded-lg (banned 8px) used 6 times, bare `border` resolving to `border-color: currentColor` instead of the border token, the plain-accent-as-fill contrast bug reproduced on the save button (2.96:1) and wallet/referral link text, and --color-ad (reserved exclusively for the featured-salon badge) misused for the logout action -- the only non-badge usage of that token anywhere in the app.

## Overall Impression

This page gates two of the most fully-designed surfaces in the app (wallet, referral) and looks like the pre-migration prototype they left behind. The peak-end moment is bad: the page ends on a logout button styled in the sponsorship-badge color, no padding, no divider -- a destructive account action visually reads as a promo tag.

## What's Working

1. wallet.vue and referral.vue (this page's own children) are genuinely good -- proper BaseCard/BaseButton composition, correct empty states, accent used exactly once each.
2. The push-notification toggle at least gives immediate, correct label feedback.
3. Favorites/gender data correctly round-trips through the real session store -- no placeholder content.

## Priority Issues

**[P1] Zero Base* system compliance.** No BaseCard/BaseButton/BaseInput/BaseSelect/BaseIcon anywhere; rounded-lg used 6x instead of the 12/16px scale.

**[P1] No feedback on the page's one real action (save profile).** No loading spinner, no success toast -- a user has no idea whether their change persisted.

**[P1] English server-validation error can leak into an all-Persian UI.** No client-side length guard on the name field matching the server's constraint.

**[P2] One Seal Rule violated 4x on a single screen.** Accent color used concurrently on the save button, wallet link, referral link, and the push-toggle's active state.

**[P2] Logout borrows the "sponsored" color and has a sub-minimum tap target.** text-(--color-ad) instead of --color-danger, ~83x20px measured, well under both the 44px guideline and WCAG 2.2's 24px AA floor.

## Persona Red Flags

**Sam (accessibility):** Gender select has no label at all, screen-reader-visible or otherwise. Push toggle has no aria-pressed/role=switch despite this app's own ThemeToggle.vue doing exactly this correctly two component-levels away.
**Jordan (first-timer):** Unlabeled fields force inference from position alone; after tapping save, nothing visibly changes.
**Casey (distracted mobile):** Push-toggle and logout both fall well under 44px -- easy one-handed mis-taps. No draft/autosave if interrupted mid-edit.

## Minor Observations

No useSeoMeta call, unlike its own child pages. Favorites empty state is a dead end with no CTA back to discovery. Favorites fetch uses silent:true, so a real API failure is indistinguishable from a genuinely-empty list. Equal vertical rhythm regardless of section importance.

## Questions to Consider

- If wallet and referral are two of the most fully-designed surfaces in the app, why does the page that gates both of them look like the pre-migration prototype they left behind?
- What does "save" actually tell the user right now besides a button going briefly gray?
- The product's positioning is "verified, trust legible at a glance" -- what does this page, about the user's own identity, currently make legible about them at all?
