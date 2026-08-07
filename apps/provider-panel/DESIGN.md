---
name: Gheychi Provider Panel
description: The salon owner's operating console — the same Verified Ledger identity as the customer app, tuned for Operate mode.
colors:
  surface: "#F4FBFA"
  surface-dark: "#151217"
  surface-card: "#FFFFFF"
  surface-card-dark: "#211D24"
  surface-subtle: "#EAF5F3"
  surface-subtle-dark: "#2A2530"
  text: "#0B4F4A"
  text-dark: "#F5F0F2"
  text-muted: "#4C716D"
  text-muted-dark: "#B3A3B0"
  border: "#DCEDEA"
  border-dark: "#38323D"
  accent-teal: "#0EA89B"
  accent-teal-strong: "#0F766E"
  accent-teal-deep: "#115E59"
  accent-teal-soft: "#E3F6F3"
  accent-teal-text: "#0F766E"
  accent-violet: "#7A3FF2"
  accent-violet-strong: "#6D28D9"
  accent-violet-deep: "#5B21B6"
  accent-violet-soft: "#2C2140"
  accent-violet-text: "#A78BFA"
  danger: "#C0392B"
  danger-dark: "#F2645C"
  danger-strong: "#B91C1C"
  danger-strong-dark: "#9F1239"
  danger-soft: "#FCEAEA"
  danger-soft-dark: "#3A2229"
  success: "#1E9E6B"
  success-dark: "#3FC98A"
  warning: "#955F09"
  warning-dark: "#FBBF24"
  warning-soft: "#FEF3DE"
  warning-soft-dark: "#332507"
  info: "#2A5FBE"
  info-dark: "#A5A8F5"
  info-soft: "#E7EFFC"
  info-soft-dark: "#1E2247"
typography:
  headline:
    fontFamily: "Vazirmatn Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.6
    letterSpacing: "normal"
  title:
    fontFamily: "Vazirmatn Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Vazirmatn Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Vazirmatn Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  caption:
    fontFamily: "Vazirmatn Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  md: "12px"
  lg: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-teal}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-teal-strong}"
  button-secondary:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-danger:
    backgroundColor: "{colors.danger-strong}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  card:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.lg}"
    padding: "16px"
  status-badge:
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
---

# Design System: Gheychi Provider Panel

## Overview

**Creative North Star: "The Verified Ledger" (inherited, not reinvented)**

This is the same product, viewed from the salon owner's side of the counter, and PRODUCT.md says so explicitly: *"Whatever visual world is chosen for the platform should be shared/consistent across `user-app`, `provider-panel`, and `admin-panel` rather than decided independently per app, since they're one product from three different roles' viewpoints."* This document therefore does not invent a new identity — it canonizes `apps/user-app/DESIGN.md`'s "Verified Ledger" system (precise, quietly official, trust-legible-at-a-glance, two-mode teal/violet re-theme, Vazirmatn-only type, restrained shadow-as-signal) as this app's system too, and adapts it for **Operate mode**: a salon owner checking bookings between clients needs scanability and fast task completion, not persuasion. Read `apps/user-app/DESIGN.md` in full alongside this file — it is the parent document; this one records only what differs because the surface is Operate rather than a mixed Persuade/Operate app.

**A token audit against `apps/user-app/app/assets/css/main.css` (2026-07-24) found the core palette already correctly shared** — `--color-accent` (`#0EA89B`/`#7A3FF2`), `--color-surface`, `--color-surface-card`, and `--color-text` are byte-identical between the two apps, and `main.css`'s own comments confirm this was deliberate. **A follow-up reconciliation pass has since closed the rest of the gap this section used to describe** — the frontmatter above is no longer aspirational, it now matches `apps/provider-panel/src/assets/css/main.css` on every point below:

- `--color-accent-strong`/`--color-accent-deep`/`--color-accent-soft`/`--color-accent-text` **now exist** in provider-panel's `main.css` (light and dark blocks), byte-identical to user-app. `AppButton.vue`'s primary variant already pairs them correctly on hover (`hover:bg-(--color-accent-deep) hover:shadow-(--shadow-md)`) — the token-level gap and the component-level bug it caused are both closed. One narrower remnant survives: `AppButton`'s `danger` variant still ships `hover:opacity-90` only, with no shadow/color-shift pairing (see Components → Buttons below).
- `--color-border` and `--color-text-muted` are now byte-identical to user-app's values in both modes (`#DCEDEA`/`#38323D` and `#4C716D`/`#B3A3B0`) — the "drifted by a few RGB units" finding no longer holds for these tokens. One vestige remains: the light-mode `.native-select` chevron in `main.css` still hardcodes the pre-fix muted color into its inline SVG (`stroke='%235B8A86'`) instead of the corrected value — the dark-mode chevron (`%23B3A3B0`) already matches `--color-text-muted` dark exactly, so only the light SVG was missed when the token itself was fixed.
- **The `--color-text-muted` accessibility fix has fully landed and needs no further action here.** User-app's `text-muted` was darkened from `#5B8783` to `#4C716D` after measuring ~4.0:1 (light mode), below WCAG AA's 4.5:1 floor; provider-panel's `--color-text-muted` already carries that exact corrected value in both files.
- **Dark-mode shadows now carry the hue tint.** Provider-panel's shadow system was reconciled onto user-app's exact three-step model — one `--shadow-color` HSL variable (`178 45% 20%` light, `275 55% 4%` dark) drives `--shadow-sm`/`--shadow-md`/`--shadow-lg`, byte-identical between the two files. The old two-step `--shadow-panel`/`--shadow-pop` vocabulary with hardcoded `rgba(0,0,0,…)` dark-mode shadows no longer exists.
- **A gap the original audit missed, still open today:** provider-panel has no flat `--color-success`/`--color-warning`/`--color-danger-soft` tokens at all — those roles are served by a separately-named, independently contrast-tuned `--tone-*-bg`/`--tone-*-text` pair per semantic color instead (see Colors → Semantic below). Separately, `--color-surface-subtle` is referenced three times in `EarningsView.vue` (`bg-(--color-surface-subtle)`) but is **not defined anywhere in `main.css`** — a real, currently-unnoticed token gap (see Colors → Neutral below).

**New, legitimate additions this app needs that user-app doesn't**: a `warning` and `info` semantic (alongside the inherited `danger`/`success`), because Operate-mode booking/salon-status screens have states user-app's customer-facing surfaces don't (a pending booking awaiting confirmation, a salon in `pending`/`rejected`/`suspended` review status). These are documented as sanctioned system extensions below, not drift — and are the natural shared vocabulary `apps/admin-panel` should reach for too rather than inventing its own third set.

**Key Characteristics (inherited from user-app, restated for this surface):**
- Same two-mode re-theme: light is teal-accented, dark is violet-accented — the hue itself changes between modes.
- Restrained, purposeful shadow use — elevation signals a genuine raised surface, never ambient texture.
- One typeface (Vazirmatn Variable), one accent per mode, a tight neutral scale.
- Operate-mode discipline on top of that shared skin: default to compact density, favor scanable lists/tables over persuasive full-bleed moments, and treat the accent color even more sparingly than user-app does — a dashboard screen typically has one primary action, sometimes zero.

## Colors

Same palette architecture as user-app (one accent per mode, warm-neutral surface scale), extended with two Operate-mode semantic states this app's status-heavy screens need.

### Primary
- **Certified Teal** (`#0EA89B` light) / **Notarized Violet** (`#7A3FF2` dark): identical role to user-app — the one interactive/brand signal, used sparingly. On a dashboard-style screen this often means exactly one accent-colored element (the single primary action), sometimes none if the screen is pure review/status.
- **Accent Strong** (`#0F766E` light / `#6D28D9` dark) / **Accent Deep** (`#115E59` light / `#5B21B6` dark): fill-only hover/active pair for the primary button, verified ≥4.5:1 for white text on top of it in both modes — matches the exact values user-app's session-long contrast-fix work landed on (not independently re-derived).
- **Accent Text** (`#0F766E` light / `#A78BFA` dark): the accent hue used as small *foreground text* (inline links, accent-toned labels) rather than as a fill — a distinct token from Accent Strong because a fill-safe shade is not automatically a text-safe shade (accent-strong measures only 2.33:1 as text in dark mode, a real WCAG failure user-app hit and fixed with this exact token).
- **Accent Soft** (`#E3F6F3` light / `#2C2140` dark): accent-tinted fill for badges and selected states.

### Neutral
Identical to user-app: **Surface** (`#F4FBFA`/`#151217`), **Surface Card** (`#FFFFFF`/`#211D24`), **Text** (`#0B4F4A`/`#F5F0F2`), **Text Muted** (`#4C716D`/`#B3A3B0`, byte-identical, no drift), **Border** (`#DCEDEA`/`#38323D`, byte-identical, no drift). **Surface Subtle is a real, still-open gap**: `--color-surface-subtle` is referenced three times in `EarningsView.vue` (`bg-(--color-surface-subtle)`) but is not defined anywhere in provider-panel's `main.css` — it should be added with user-app's value (`#EAF5F3`/`#2A2530`) to match what the code already assumes exists.

### Semantic
- **Danger** (`--color-danger`, `#C0392B` light / `#F2645C` dark) for text/borders, **Danger Strong** (`--color-danger-strong`, `#B91C1C`/`#9F1239`) for white-text-on-fill use — both byte-identical to user-app. There is no standalone `--color-danger-soft` token, though: tinted-background danger states go through `--tone-danger-bg`/`--tone-danger-text` instead (`#FCE8EA`/`#C22B3F` light, `#33141B`/`#FB7185` dark) — close to but not identical with user-app's `--color-danger-soft` (`#FCEAEA`/`#3A2229`), because it was independently contrast-verified for text-on-tint rather than copied over.
- **Success**: provider-panel has no flat `--color-success` token at all (user-app's is `#1E9E6B`/`#3FC98A`) — the role is served entirely by `--tone-success-bg`/`--tone-success-text` (`#E3F7EE`/`#0D7A48` light, `#16301F`/`#4ADE80` dark), the same fill/text-split pattern the Fill-Text Split Rule already describes for accent, just extended to every semantic color under a `tone-` prefix rather than separately named per color.
- **Warning** (`--tone-warning-bg`/`--tone-warning-text`: `#FEF3DE`/`#955F09` light, `#332507`/`#FBBF24` dark): a sanctioned new addition — pending/needs-attention states (a booking awaiting confirmation, a salon in `pending` review) that are neither an error nor a success. The light-mode text value was darkened from an originally-planned `#B4740E` after it measured 3.51:1 against `--tone-warning-bg` (below WCAG AA) — the same class of fix `--color-text-muted` got.
- **Info** (`--tone-info-bg`/`--tone-info-text`: `#E7EFFC`/`#2A5FBE` light, `#1E2247`/`#A5A8F5` dark): a sanctioned new addition — neutral informational states (e.g. a resubmission notice) that shouldn't read as urgent. No drift — matches this document's frontmatter exactly.

### Named Rules
**The One Seal Rule** (inherited). On a dashboard/list screen, this typically means the ONE primary action in the page's header or the one row currently being acted on — not a decorative accent on every card.

**The No Mode-Agnostic Color Rule** (inherited). Every token ships with both a light and dark value.

**The Fill-Text Split Rule** (new, Operate-specific, but really a restatement of a bug user-app already hit). A "strong" accent/danger shade verified for **white text on top of it as a fill** is not automatically safe as **foreground text on a card background** — the two directions must be measured and tokenized separately (`accent-strong` vs `accent-text`). Status-badge-heavy screens like this app's Bookings/Team/Coupons views are exactly where this bug recurs, because status labels are foreground text far more often than they are fills.

## Typography

Identical scale and rationale to user-app — see that document's Typography section. One Operate-mode-specific note: **Title (700, 1.25rem)**, not Headline, is this app's workhorse size — every list/settings screen needs a clear "this is where you are" heading, but a Persuade-scale Headline is rarely appropriate here (reserve it for `LoginView.vue`'s own hero copy, the one screen in this app that is closer to Persuade than Operate).

### Named Rules
**The Weight-Over-Size Rule** (inherited).

## Layout

Denser than user-app's baseline by default — this is an Operate-mode app for a between-clients phone check, and PRODUCT.md's Product Principles state usage happens "in short bursts on a phone between clients." Tables/lists should default to compact row height and `spacing.sm`/`md` rhythm; reserve `spacing.lg`/`xl` for genuine section breaks (between a page's header and its content, between settings sections) rather than as a resting density.

On desktop/tablet — PRODUCT.md explicitly calls out longer focused setup/earnings-review sessions on a larger screen as an equally real usage mode, not a secondary one — screens with tabular data (bookings, earnings) should use the wider viewport for more visible rows/columns rather than simply centering a narrow mobile column with wasted margins.

### Named Rules
**The Density-First Rule** (inherited, stronger here than in user-app): default to compact spacing; this app has essentially no Persuade-mode screens to except from that rule other than the login hero.

## Elevation & Depth

Same shadow philosophy as user-app: flat + bordered is the default resting state; a shadow marks genuine elevation (a card, a modal/dropdown overlay, the primary button). **This reconciliation is complete.** Provider-panel's `main.css` now uses the same three-step, hue-driven `--shadow-sm`/`--shadow-md`/`--shadow-lg` system as user-app, both driven by one `--shadow-color` HSL variable that is byte-identical between the two files in both modes — dark mode carries the violet hue tint (`hsl(275 55% 4% / α)`), not pure black. The old two-step `--shadow-panel`/`--shadow-pop` vocabulary no longer exists.

### Named Rules
**The Elevation-Means-Something Rule** (inherited).

**The Hue-Tinted Shadow Rule** (inherited; provider-panel's dark mode now correctly follows it). A shadow is never neutral black — it carries the mode's accent hue (dark teal in light mode, near-black violet in dark mode) even at low opacity, so depth and brand identity are conveyed by the same signal.

## Shapes

Identical three-step scale to user-app: `rounded.full` (pills, badges, avatars), `rounded.md`/12px (controls — buttons, inputs, selects), `rounded.lg`/16px (containers — cards, panels). `AppCard.vue` (`rounded-2xl`) and `AppButton.vue`/`AppInput.vue` (`rounded-xl`) land on the correct numeric values via plain Tailwind classes rather than named-token references — visually correct today; a later pass could still swap the literal Tailwind classes for token references for consistency's sake, but this is cosmetic, not a bug.

### Named Rules
**The Container-Softer-Than-Control Rule** (inherited).

**The No Physical-Direction Leak Rule** (inherited). `LoginView.vue`'s input icon leak is fixed: the page now uses `AppInput.vue`, whose icon is positioned with the logical `start-3.5` (not a physical `right-3.5`/`left-3.5`) — same defect class as user-app's now-fixed `BaseSelect.vue` chevron, now closed here too.

## Components

### Buttons
`AppButton.vue` now exists (`src/components/ui/AppButton.vue`) and implements the shape/variant contract directly:
- **Shape:** `rounded-xl` (12px, matches `rounded.md`).
- **Primary:** `accent-strong` background, white text, `shadow.sm` at rest → `shadow.md` + `accent-deep` background on hover (`bg-(--color-accent-strong) shadow-(--shadow-sm) hover:bg-(--color-accent-deep) hover:shadow-(--shadow-md)`) — the shadow-depth-plus-color-shift pairing this document used to flag as missing app-wide is implemented here.
- **Secondary:** `border-soft` background, `text` color, hover to `border` — uses `--color-border-soft`, not `--color-surface-subtle` (which isn't defined in provider-panel's `main.css` at all; see Colors → Neutral).
- **Danger:** `danger-strong` background (not plain `danger` — the fill-safe variant), white text, but still **`hover:opacity-90` only, with no shadow/color-shift pairing** — the one variant where the bug this document used to describe app-wide is still live.
- **Ghost:** transparent, `text-muted`, hover to `border-soft` fill and full `text` color.
- Migration to `AppButton` is not complete but the remaining gap is small: 3 raw `<button>` elements across 2 files (`AppLayout.vue`'s theme-toggle and logout buttons, `OnboardingView.vue`'s logout button) — all square icon-only buttons outside `AppButton`'s label+icon contract, a defensible exception rather than unmigrated debt, not the 31-across-15-files gap previously documented.

### Status Badge (signature component — genuinely good, worth documenting as a pattern user-app should consider back-porting)
`StatusBadge.vue` already exists and is on-token: `rounded.full`, `px-2.5 py-1`, a small leading dot, tone-mapped background/text pairs across success/warning/danger/neutral/info. This is exactly the shared status vocabulary a booking-status-heavy, salon-status-heavy app needs and user-app's `bookings/index.vue` currently re-implements ad hoc per status (`STATUS_META` inline classes) — a candidate for extraction into a shared pattern across all three apps in a later pass, not an action item for this document.

### Cards / Containers
- **Corner Style:** `rounded.lg` (16px) — `AppCard.vue` already correct.
- **Shadow Strategy:** `--shadow-sm` at rest, static — correct, and (per Elevation & Depth above) already hue-tinted in dark mode.
- **Border:** 1px `border`, always present alongside the shadow — already correct.

### Inputs / Fields
`AppInput.vue` now exists (`src/components/ui/AppInput.vue`) and implements the contract: `rounded-xl` (12px), `surface-card` background, accent border + 30%-opacity focus ring, `danger` border + caption error (with a warning icon) on validation failure, plus an optional leading icon positioned with the logical `start-3.5`/`ps-11` (see the No Physical-Direction Leak Rule above). Migration is partial: 13 raw `<input>` elements remain across 7 files (`ScheduleStep.vue`, `SalonPinPicker.vue`, `PhotoUploader.vue`, `ServicesView.vue`, `HoursView.vue`, `SalonSettingsView.vue`, `TeamView.vue`) — down from the 34-elements gap previously documented, but still a real, open migration item.

### Dropdowns / Selects
`AppSelect.vue` wraps `vue-multiselect` rather than user-app's native-`<select>`-plus-chevron approach — an acceptable implementation difference (different tech, same visual contract) as long as radius (`0.75rem`/12px, already correct) and elevation stay on-token. The dropdown-panel elevation gap this document used to flag is fixed: `.app-select .multiselect__content-wrapper` now uses `--shadow-md`, a genuinely more-elevated tier than the resting-card shadow, matching a floating overlay's intended role.

## Do's and Don'ts

### Do:
- **Do** treat this document as inheriting from, not replacing, `apps/user-app/DESIGN.md` — when in doubt about a rule not restated here, the parent document governs.
- **Do** finish migrating the remaining hand-rolled `<button>`/`<input>` elements onto `AppButton`/`AppInput` (both now exist) — 3 raw buttons and 13 raw inputs remain, down from the original 31/34, but full migration is still the right end state.
- **Do** pair a shadow-depth change with a color change on hover for every button variant — already done for `primary`; `danger` still needs it (currently `hover:opacity-90` only).
- **Do** use logical CSS properties (`start-`/`end-`) for positioned elements — `AppInput.vue`'s icon already does this (`start-3.5`); keep it that way as new components are added.
- **Do** keep the `warning`/`info` semantic additions — they are a legitimate Operate-mode need, not drift.

### Don't:
- **Don't** assume `--color-border`/`--color-text-muted` need reconciling — they're already byte-identical to user-app's values; the one remaining vestige is the hardcoded pre-fix stroke color in `main.css`'s light-mode `.native-select` chevron SVG. `--tone-danger-text`/`--tone-success-text` aren't comparable to user-app 1:1 — user-app has no equivalent tone-pair system, so these are provider-panel's own independently-contrast-verified tokens, not drift.
- **Don't** use pure black (`rgba(0,0,0,…)`) for a dark-mode shadow — already avoided; `--shadow-color`'s violet HSL tint per the Hue-Tinted Shadow Rule is in place in both files.
- **Don't** add a third, independently-invented status-tone vocabulary in `apps/admin-panel` later — this document's `warning`/`info` additions are the reference for what admin-panel should reach for too.
