---
name: Gheychi Admin Panel
description: The operator console — the same Verified Ledger identity as the customer app, tuned for a desk-based, high-density, accountability-first Operate surface.
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

# Design System: Gheychi Admin Panel

## Overview

**Creative North Star: "The Verified Ledger" (inherited, not reinvented)**

Same rationale as `apps/provider-panel/DESIGN.md`: PRODUCT.md states this app "should share a visual language with `user-app`/`provider-panel` rather than diverging as an unrelated internal tool." This document canonizes `apps/user-app/DESIGN.md`'s system here too, adapted for what PRODUCT.md calls the sharpest-edged Operate surface in the platform: a small internal team, desk-based, running trust-and-safety and money-moving operations where **every mutating action is already audit-logged** and the design's job is to make that fact implicit and the action's consequence unambiguous before it happens — not to persuade or delight.

**A code scan of `apps/admin-panel/src/assets/css/main.css` (2026-08-04) found it already reconciled onto the shared target** — `--color-text-muted`, `--color-border-soft`, `--color-accent-strong`/`-deep`/`-soft`/`-text`, and `--color-danger-strong` all exist and are byte-identical in value to `apps/provider-panel/src/assets/css/main.css` and `apps/user-app/app/assets/css/main.css`'s equivalents (`#0F766E`/`#115E59`/`#E3F6F3`/`#0F766E` light, `#6D28D9`/`#5B21B6`/`#2C2140`/`#A78BFA` dark). The shadow system is the same hue-tinted, three-step `--shadow-color`/`--shadow-sm`/`--shadow-md`/`--shadow-lg` design in both light and dark mode — no pure-black `rgba(0,0,0,…)` dark-mode shadow and no hardcoded-teal focus ring; focus rings use `--color-accent` via `color-mix()`, correct in both modes. The token set below (frontmatter above) is not a migration target here — it is the current, verified state of `main.css`.

**What's different here, per PRODUCT.md, is priority and density, not palette:**
- **Desktop-primary, not mobile-capable-by-default.** PRODUCT.md is explicit: "do not over-invest in a mobile-optimized layout at the expense of information density a desk-based operator needs." Tables are the primary UI pattern here far more than in provider-panel — dense rows, visible columns, minimal wasted margin, not a card-per-row mobile-first layout that happens to also work on desktop.
- **Every consequential action needs a confirm step, uniformly.** PRODUCT.md's Product Principle 2: "Money-moving and trust/moderation actions get the same elevated clarity bar — neither outranks the other." A salon suspension and a wallet adjustment should feel equally deliberate to trigger, not one guarded by a modal and the other a bare click.
- **The audit trail is a confidence feature, not a hidden compliance detail** (Product Principle 4) — this doesn't change color/type tokens, but it does mean any "this action was recorded" affordance (a link to the relevant audit-log entry, a "logged" indicator) deserves real visual weight when it appears, not a footnote treatment.
- **No Persuade-mode screens at all**, unlike provider-panel (which has the login hero) — the entire app is Operate. Reserve the Headline (1.875rem) type step for nothing; Title is the ceiling for every screen including login here.

**One genuinely good pattern that stays admin-panel-exclusive, not a migration target**: `Pagination.vue` — a real, extracted, reusable pagination component. Neither `apps/provider-panel/src/components/ui/` nor `apps/user-app/app/components/ui/` has an equivalent (both still hand-roll pagination controls per-page); this remains the reference to eventually back-port.

`JalaliDatePicker.vue` is **not** an admin-panel-exclusive capability — `apps/provider-panel/src/components/ui/JalaliDatePicker.vue` has a near-identical copy (237 vs. 231 lines; same jalaali-js-backed calendar logic, same RTL off-screen-popover-shift fix, same public contract). The two differ only cosmetically: provider-panel's trigger button carries an explicit `bg-(--color-surface-card)` class that admin-panel's copy omits, and a couple of code comments were reworded between copies. Provider-panel's own copy even documents the relationship in its header comment: "Mirrors admin-panel's component of the same name — kept as this app's own copy per this repo's cross-app isolation convention." Treat it as a shared pattern maintained as two near-identical files (like `AppButton.vue`/`AppCard.vue`/`AppInput.vue`/`EmptyState.vue` across the two apps), not a unique admin-panel capability.

**Key Characteristics (inherited, restated for this surface):**
- Same two-mode teal/violet re-theme as user-app and provider-panel — not an independently chosen palette.
- The highest-density, most table-heavy surface in the platform — spacing defaults even tighter than provider-panel's.
- Confirmation UI (dialogs, explicit "are you sure" steps) is a first-class, uniformly-applied pattern here, more so than in the customer-facing or provider apps, because every action here is either money-moving or trust-and-safety with no casual undo.
- The token layer is fully reconciled with the other two apps — the same mechanical fix already applied to provider-panel's own `main.css` this session is done here too; there is no outstanding token-layer gap left to close.

## Colors

Identical palette architecture to `apps/user-app/DESIGN.md` and `apps/provider-panel/DESIGN.md` — see those documents for the full rationale. Same warning/info semantic additions as provider-panel (both apps share booking/salon/report-status vocabulary), applied here to salon status, report status, referral status, and coupon status alike.

### Primary
- **Certified Teal** (`#0EA89B` light) / **Notarized Violet** (`#7A3FF2` dark): used even more sparingly here than in provider-panel — a table-heavy screen typically has one primary action (approve, save config, issue coupon) and everything else is secondary/ghost/danger.
- **Accent Strong** (`#0F766E`/`#6D28D9`) / **Accent Deep** (`#115E59`/`#5B21B6`): fill-safe hover pair, identical values to the other two apps.
- **Accent Text** (`#0F766E`/`#A78BFA`): accent hue as foreground text — distinct from Accent Strong for the same fill-vs-text contrast reason documented in the other two DESIGN.md files.
- **Accent Soft** (`#E3F6F3`/`#2C2140`): tinted fill for badges/selected rows.

### Neutral
Identical to user-app/provider-panel: **Surface**, **Surface Card**, **Surface Subtle**, **Text**, **Text Muted** (`#4C716D`/`#B3A3B0`), **Border** (`#DCEDEA`/`#38323D`).

### Semantic
- **Danger** (`#C0392B`/`#F2645C`) + **Danger Strong** (`#B91C1C`/`#9F1239`) + **Danger Soft**: errors, destructive/suspend/reject actions — the single most-used semantic color in this app given how much of its job is moderation.
- **Success** (`#1E9E6B`/`#3FC98A`): approved/resolved/granted states.
- **Warning** (`#955F09`/`#FBBF24`): pending-review states (a salon awaiting approval, an unresolved report). The light-mode text value was darkened from an originally-planned `#B4740E` after it measured 3.51:1 against `--tone-warning-bg` (below WCAG AA).
- **Info** (`#2A5FBE`/`#A5A8F5`): neutral informational states.

### Named Rules
**The One Seal Rule** (inherited, strictest application of the three apps). On a table-heavy admin screen, the accent marks exactly the one primary action in a toolbar/header — row-level actions are secondary/ghost/danger, never accent-filled, or every row in a long table would compete for attention.

**The Uniform Consequence Rule** (new, admin-specific — a UX rule as much as a color rule). Per PRODUCT.md Product Principle 2, a destructive/trust action (suspend, reject, cancel) and a money-moving action (wallet adjustment, coupon issuance, reward-type change) get the same confirm-before-commit treatment and the same `danger`/`warning` visual weight when applicable — never let one category read as more casual than the other because it happens to be a simple form field vs. a delete button.

**The Fill-Text Split Rule** (inherited from provider-panel).

## Typography

Identical scale to the other two apps. Unlike provider-panel (which reserves Headline for its login hero), **this app has no screen that should reach for Headline (1.875rem) at all** — every screen, including login, is Operate-mode; Title (1.25rem, 700) is the ceiling.

### Named Rules
**The Weight-Over-Size Rule** (inherited).

## Layout

The densest of the three apps, by explicit PRODUCT.md mandate: desktop-primary, information density over mobile-friendly simplification. Tables are the default pattern for any list of salons/users/reports/reviews/coupons/referrals — favor visible rows and columns over generous row height or card-per-item mobile patterns. `Pagination.vue` and `JalaliDatePicker.vue` are the established, correct components for their respective jobs — reuse them, don't re-hand-roll.

### Named Rules
**The Density-First Rule** (inherited, strongest form here — no Persuade-mode exception exists in this app at all, unlike provider-panel's login hero).

## Elevation & Depth

Same philosophy as `apps/provider-panel/DESIGN.md`: flat + bordered by default, shadow marks genuine elevation, hue-tinted (never pure black) in dark mode. `main.css` already ships the reconciled three-step `--shadow-sm`/`--shadow-md`/`--shadow-lg` system, driven by a single `--shadow-color` HSL variable (`178 45% 20%` light / `275 55% 4%` dark) — no separate `--shadow-panel`/`--shadow-pop` pair and no pure-black dark-mode shadow exist in this app's CSS.

### Named Rules
**The Elevation-Means-Something Rule** (inherited).

**The Hue-Tinted Shadow Rule** (inherited).

## Shapes

Identical three-step scale: `rounded.full` (pills, badges), `rounded.md`/12px (controls), `rounded.lg`/16px (containers).

### Named Rules
**The Container-Softer-Than-Control Rule** (inherited).

**The No Physical-Direction Leak Rule** (inherited) — verified clean: `LoginView.vue` and `AppInput.vue`'s positioned icon (`start-3.5`, `ps-11`/`pe-4`) use logical, not physical, properties, and a repo-wide scan of `apps/admin-panel/src` found no `absolute left-`/`absolute right-` positioning on any icon. `.app-select`'s own CSS comment already documents an intentional RTL flip for the multiselect arrow, which is correct and not an instance of this bug.

## Components

### Buttons
`AppButton.vue` exists (`apps/admin-panel/src/components/ui/AppButton.vue`) and is byte-identical to provider-panel's — same shape/variant contract: primary (`--color-accent-strong` fill, `shadow-sm` at rest → `--color-accent-deep` fill + `shadow-md` on hover), secondary (`--color-border-soft` fill), danger (`--color-danger-strong` fill), ghost (transparent, `--color-text-muted`). It is widely adopted — 27 files import it — but migration off hand-rolled markup is not total: `NotificationBell.vue`, `AppLayout.vue`, `WalletView.vue`, `ReferralSettingsView.vue`, `BlogEditorView.vue`, and `AdjustBalanceCard.vue` still contain raw `<button>` elements. `LoginView.vue` itself is fully migrated onto `AppButton`/`AppInput`.

### Status Badge
`StatusBadge.vue` already exists here too (same pattern as provider-panel's) — reuse as-is, on-token.

### Pagination (signature component, admin-panel-specific)
`Pagination.vue` is a genuinely extracted, reusable component, and this remains a real, confirmed exclusivity — neither `apps/provider-panel/src/components/ui/` nor `apps/user-app/app/components/ui/` has an equivalent; both still hand-roll pagination controls per-page. The reference both should eventually migrate toward, not something to fix here.

### Date Picker (shared pattern, not admin-panel-exclusive)
`JalaliDatePicker.vue` — a real Jalali-calendar date picker. **Correction:** this is not unique to admin-panel; `apps/provider-panel/src/components/ui/JalaliDatePicker.vue` is a near-identical copy (see Overview above for the diff), following the same cross-app-isolation convention as `AppButton`/`AppCard`/`AppInput`/`EmptyState`. Preserve as-is; the one real, minor drift between the two copies (provider-panel's trigger button has an explicit `bg-(--color-surface-card)` class that admin-panel's lacks) is cosmetic and not worth chasing as a fix-pass item.

### Cards / Containers
`AppCard.vue` exists, same contract as provider-panel's — `rounded.lg`, bordered, flat shadow at rest.

### Inputs / Fields
`AppInput.vue` exists (`apps/admin-panel/src/components/ui/AppInput.vue`) — label, optional leading icon (logical `start-3.5` positioning), error state (`--color-danger` border/ring), `rounded.md`, `--color-surface-card` fill. Used in 18 files; two files (`BlogEditorView.vue`, `AdjustBalanceCard.vue`) still contain raw `<input>` elements not yet migrated.

## Do's and Don'ts

### Do:
- **Do** treat `apps/user-app/DESIGN.md` as the parent document and `apps/provider-panel/DESIGN.md` as the sibling reference — both apps' token layers are now reconciled to the same shared values.
- **Do** finish migrating the remaining raw `<button>`/`<input>` markup (`NotificationBell.vue`, `AppLayout.vue`, `WalletView.vue`, `ReferralSettingsView.vue`, `BlogEditorView.vue`, `AdjustBalanceCard.vue`) onto `AppButton`/`AppInput` — the components exist and are already the majority pattern, this is a mop-up, not a build-from-scratch task.
- **Do** apply The Uniform Consequence Rule: the same confirm-before-commit weight for money-moving and moderation actions alike.
- **Do** preserve `JalaliDatePicker.vue` and `Pagination.vue` as-is — genuinely good, reusable, on-token components.
- **Do** favor table density over mobile-first card layouts for list screens.

### Don't:
- **Don't** invent a fourth status-tone vocabulary — reuse the warning/info additions provider-panel already established.
- **Don't** soften a destructive or money-moving action's visual weight relative to the other category.
- **Don't** describe this app's token layer as behind or unreconciled — `--color-text-muted`/`--color-border`/`--color-accent-strong` etc. are already present and already match the other two apps' values exactly.
- **Don't** add a mobile-first layout pass at the expense of desktop table density — this app's priority order is the inverse of user-app/provider-panel's.
