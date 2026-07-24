---
name: Arayeshgah Provider Panel
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
  warning: "#B4740E"
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

# Design System: Arayeshgah Provider Panel

## Overview

**Creative North Star: "The Verified Ledger" (inherited, not reinvented)**

This is the same product, viewed from the salon owner's side of the counter, and PRODUCT.md says so explicitly: *"Whatever visual world is chosen for the platform should be shared/consistent across `user-app`, `provider-panel`, and `admin-panel` rather than decided independently per app, since they're one product from three different roles' viewpoints."* This document therefore does not invent a new identity — it canonizes `apps/user-app/DESIGN.md`'s "Verified Ledger" system (precise, quietly official, trust-legible-at-a-glance, two-mode teal/violet re-theme, Vazirmatn-only type, restrained shadow-as-signal) as this app's system too, and adapts it for **Operate mode**: a salon owner checking bookings between clients needs scanability and fast task completion, not persuasion. Read `apps/user-app/DESIGN.md` in full alongside this file — it is the parent document; this one records only what differs because the surface is Operate rather than a mixed Persuade/Operate app.

**A token audit against `apps/user-app/app/assets/css/main.css` (2026-07-24) found the core palette already correctly shared** — `--color-accent` (`#0EA89B`/`#7A3FF2`), `--color-surface`, `--color-surface-card`, and `--color-text` are byte-identical between the two apps, and `main.css`'s own comments confirm this was deliberate. But the token layer is **incomplete relative to user-app**, and that incompleteness has real, visible consequences documented below. **This document canonizes the reconciled, complete token set** (frontmatter above) as the target — several values in it do not yet exist in `apps/provider-panel/src/assets/css/main.css` and are migration targets, not a description of current state:

- `--color-accent-strong`/`--color-accent-deep`/`--color-accent-soft`/`--color-accent-text` **do not exist yet** in provider-panel's `main.css`. This is the single largest gap: every primary button in the app hovers via `opacity-90` alone (13 occurrences across `LoginView.vue`, `OnboardingView.vue`, `HoursView.vue`, `ServicesView.vue`, `CouponsView.vue`, `TeamView.vue`, `PendingApprovalView.vue`, `SalonSettingsView.vue`) instead of the mandated shadow-depth-plus-color-shift pairing — the component-level bug (finding for the fix pass) traces directly to a token-level gap (finding for this document).
- `--color-border`, `--color-muted`/`--color-text-muted`, the danger/success pair, and the elevation shadow hue are all present but **drifted** from user-app's values by a few RGB units to tens of RGB units — reads as independently-re-eyeballed rather than copied. The frontmatter above uses user-app's exact values as the single source of truth; provider-panel's `main.css` should be updated to match exactly rather than treated as an equally-valid alternative.
- **`--color-muted`'s drift is not cosmetic — it is a live accessibility regression.** User-app's `text-muted` was deliberately darkened from `#5B8783` to `#4C716D` earlier this session after measuring it at ~4.0:1 (light mode), below WCAG AA's 4.5:1 floor. Provider-panel's `--color-muted` (`#5B8A86`) is effectively the pre-fix value and almost certainly carries the same failure — this pulls the already-verified fix forward rather than re-deriving it.
- **Dark-mode shadows have lost their hue tint.** User-app's shadow system is driven by one `--shadow-color` HSL variable (a near-black violet in dark mode) specifically so a shadow still carries the mode's identity. Provider-panel's `--shadow-panel`/`--shadow-pop` hardcode literal `rgba(0,0,0,…)` in dark mode — pure black, not violet-tinted. This document's Elevation & Depth section below restates the hue-tinted rule as binding for this app too.

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
Identical to user-app: **Surface** (`#F4FBFA`/`#151217`), **Surface Card** (`#FFFFFF`/`#211D24`), **Surface Subtle** (`#EAF5F3`/`#2A2530`), **Text** (`#0B4F4A`/`#F5F0F2`), **Text Muted** (`#4C716D`/`#B3A3B0`), **Border** (`#DCEDEA`/`#38323D`).

### Semantic
- **Danger** (`#C0392B` light / `#F2645C` dark) for text/borders, **Danger Strong** (`#B91C1C`/`#9F1239`) for white-text-on-fill use, **Danger Soft** (`#FCEAEA`/`#3A2229`) as tinted background — inherited from user-app verbatim.
- **Success** (`#1E9E6B` light / `#3FC98A` dark): confirmation states — inherited verbatim.
- **Warning** (`#B4740E` light / `#FBBF24` dark, `--color-warning-soft` `#FEF3DE`/`#332507`): a sanctioned new addition — pending/needs-attention states (a booking awaiting confirmation, a salon in `pending` review) that are neither an error nor a success.
- **Info** (`#2A5FBE` light / `#A5A8F5` dark, `--color-info-soft` `#E7EFFC`/`#1E2247`): a sanctioned new addition — neutral informational states (e.g. a resubmission notice) that shouldn't read as urgent.

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

Same shadow philosophy as user-app: flat + bordered is the default resting state; a shadow marks genuine elevation (a card, a modal/dropdown overlay, the primary button). **Provider-panel's current two-step shadow vocabulary (`--shadow-panel`, `--shadow-pop`) should be reconciled onto user-app's three-step, hue-driven system** rather than kept as a separately-hardcoded `rgba()` pair — in particular, dark-mode shadows must carry the violet hue tint (`hsl(275 55% 4% / α)`), not pure black, to match the binding rule below.

### Named Rules
**The Elevation-Means-Something Rule** (inherited).

**The Hue-Tinted Shadow Rule** (inherited, restated because provider-panel's dark mode currently violates it). A shadow is never neutral black — it carries the mode's accent hue (dark teal in light mode, near-black violet in dark mode) even at low opacity, so depth and brand identity are conveyed by the same signal.

## Shapes

Identical three-step scale to user-app: `rounded.full` (pills, badges, avatars), `rounded.md`/12px (controls — buttons, inputs, selects), `rounded.lg`/16px (containers — cards, panels). Provider-panel's existing `AppCard.vue` (`rounded-2xl`) and hand-rolled buttons (`rounded-xl`) already land on the correct numeric values by coincidence of using the same Tailwind defaults user-app does — the fix pass should replace the ad hoc Tailwind classes with the same named-token references user-app uses, not change the actual radii.

### Named Rules
**The Container-Softer-Than-Control Rule** (inherited).

**The No Physical-Direction Leak Rule** (inherited). `LoginView.vue`'s input icon (`absolute right-3.5`) is a confirmed violation — should be `end-3.5`, same defect class as user-app's now-fixed `BaseSelect.vue` chevron.

## Components

### Buttons
Same shape/variant contract as user-app's `BaseButton`, with one addition:
- **Shape:** `rounded.md` (12px).
- **Primary:** accent background, white text, `shadow.sm` at rest → `shadow.md` + `accent-strong` background on hover — **currently missing app-wide** (every primary button here is `hover:opacity-90` only, with no resting shadow); this is the top fix-pass priority.
- **Secondary:** `surface-subtle` background, `text` color.
- **Danger:** `danger-strong` background (not plain `danger` — the fill-safe variant), white text.
- **Ghost:** transparent, `text-muted`, hover to `surface-subtle` fill.
- There is currently no `AppButton.vue` component at all — every button in the app hand-rolls its own class string (31 raw `<button>` elements across 15 files). Introducing one shared component is the single highest-leverage fix, since it is the reason the hover-state bug above is universal rather than isolated.

### Status Badge (signature component — genuinely good, worth documenting as a pattern user-app should consider back-porting)
`StatusBadge.vue` already exists and is on-token: `rounded.full`, `px-2.5 py-1`, a small leading dot, tone-mapped background/text pairs across success/warning/danger/neutral/info. This is exactly the shared status vocabulary a booking-status-heavy, salon-status-heavy app needs and user-app's `bookings/index.vue` currently re-implements ad hoc per status (`STATUS_META` inline classes) — a candidate for extraction into a shared pattern across all three apps in a later pass, not an action item for this document.

### Cards / Containers
- **Corner Style:** `rounded.lg` (16px) — `AppCard.vue` already correct.
- **Shadow Strategy:** `shadow.sm`-equivalent (`--shadow-panel`) at rest, static — already correct in spirit; needs the hue-tinted-in-dark-mode fix above.
- **Border:** 1px `border`, always present alongside the shadow — already correct.

### Inputs / Fields
Same contract as user-app: `rounded.md`, `surface-card` background, accent border + 30%-opacity ring on focus, `danger` border + caption error on validation failure. There is currently no `AppInput.vue` — 34 raw `<input>` elements hand-roll this per-page; same fix priority as buttons.

### Dropdowns / Selects
`AppSelect.vue` wraps `vue-multiselect` rather than user-app's native-`<select>`-plus-chevron approach — an acceptable implementation difference (different tech, same visual contract) as long as radius (`0.75rem`/12px, already correct) and elevation stay on-token. One gap: the dropdown panel currently uses `--shadow-panel` (a resting-card shadow) rather than a more elevated tier — a floating overlay should read as more elevated than a static card, matching `shadow.md`/`shadow.lg`'s intended role once the shadow system above is reconciled.

## Do's and Don'ts

### Do:
- **Do** treat this document as inheriting from, not replacing, `apps/user-app/DESIGN.md` — when in doubt about a rule not restated here, the parent document governs.
- **Do** compose a shared `AppButton`/`AppInput` (to be built) rather than hand-rolling button/input markup per page — the current per-page duplication is why the hover-state and radius rules drifted independently across 15+ files.
- **Do** pair a shadow-depth change with a color change on the primary button's hover state (currently missing app-wide).
- **Do** use logical CSS properties (`start-`/`end-`) for positioned elements — `LoginView.vue`'s input icon is a confirmed violation to fix.
- **Do** keep the `warning`/`info` semantic additions — they are a legitimate Operate-mode need, not drift.

### Don't:
- **Don't** treat provider-panel's current `--color-border`/`--color-muted`/`--tone-danger-text`/`--tone-success-text` hex values as an equally-valid alternative to user-app's — they are unintentional drift (a few RGB units off, re-eyeballed rather than copied) and should be corrected to match exactly.
- **Don't** use pure black (`rgba(0,0,0,…)`) for a dark-mode shadow — it must carry the violet hue tint per the Hue-Tinted Shadow Rule.
- **Don't** add a third, independently-invented status-tone vocabulary in `apps/admin-panel` later — this document's `warning`/`info` additions are the reference for what admin-panel should reach for too.
