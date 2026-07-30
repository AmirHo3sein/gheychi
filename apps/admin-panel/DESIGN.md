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

# Design System: Gheychi Admin Panel

## Overview

**Creative North Star: "The Verified Ledger" (inherited, not reinvented)**

Same rationale as `apps/provider-panel/DESIGN.md`: PRODUCT.md states this app "should share a visual language with `user-app`/`provider-panel` rather than diverging as an unrelated internal tool." This document canonizes `apps/user-app/DESIGN.md`'s system here too, adapted for what PRODUCT.md calls the sharpest-edged Operate surface in the platform: a small internal team, desk-based, running trust-and-safety and money-moving operations where **every mutating action is already audit-logged** and the design's job is to make that fact implicit and the action's consequence unambiguous before it happens — not to persuade or delight.

**A code scan of `apps/admin-panel/src/assets/css/main.css` (2026-07-24) found it in nearly the identical pre-fix state `apps/provider-panel`'s own main.css was in before this session's reconciliation pass** — same `--color-muted` (not `--color-text-muted`), same drifted `--color-border` (`#DCEEEC`/`#362F3D`), same missing `--color-accent-strong/-deep/-soft/-text`, same hardcoded `--shadow-panel`/`--shadow-pop` with pure-black dark-mode shadows, same hardcoded-teal focus ring that's wrong in dark mode. **This is not a coincidence** — both apps were evidently scaffolded from the same starting point and never reconciled against each other or against user-app's later contrast-fix work. The token set below (frontmatter above) is the same reconciled target already implemented in provider-panel; the fix here is the identical mechanical pass, not a new investigation.

**What's different here, per PRODUCT.md, is priority and density, not palette:**
- **Desktop-primary, not mobile-capable-by-default.** PRODUCT.md is explicit: "do not over-invest in a mobile-optimized layout at the expense of information density a desk-based operator needs." Tables are the primary UI pattern here far more than in provider-panel — dense rows, visible columns, minimal wasted margin, not a card-per-row mobile-first layout that happens to also work on desktop.
- **Every consequential action needs a confirm step, uniformly.** PRODUCT.md's Product Principle 2: "Money-moving and trust/moderation actions get the same elevated clarity bar — neither outranks the other." A salon suspension and a wallet adjustment should feel equally deliberate to trigger, not one guarded by a modal and the other a bare click.
- **The audit trail is a confidence feature, not a hidden compliance detail** (Product Principle 4) — this doesn't change color/type tokens, but it does mean any "this action was recorded" affordance (a link to the relevant audit-log entry, a "logged" indicator) deserves real visual weight when it appears, not a footnote treatment.
- **No Persuade-mode screens at all**, unlike provider-panel (which has the login hero) — the entire app is Operate. Reserve the Headline (1.875rem) type step for nothing; Title is the ceiling for every screen including login here.

**Two genuinely good existing patterns worth preserving, not migration targets**: `JalaliDatePicker.vue` (a real, non-trivial reusable component neither user-app nor provider-panel has) and `Pagination.vue` (an extracted, reusable pagination control — provider-panel and user-app both still hand-roll pagination buttons per-page; this is the reference to eventually back-port).

**Key Characteristics (inherited, restated for this surface):**
- Same two-mode teal/violet re-theme as user-app and provider-panel — not an independently chosen palette.
- The highest-density, most table-heavy surface in the platform — spacing defaults even tighter than provider-panel's.
- Confirmation UI (dialogs, explicit "are you sure" steps) is a first-class, uniformly-applied pattern here, more so than in the customer-facing or provider apps, because every action here is either money-moving or trust-and-safety with no casual undo.
- The token layer is currently the least reconciled of the three apps — the largest gap between this document's target and shipped code, mirroring exactly what provider-panel looked like before this session's fix.

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
- **Warning** (`#B4740E`/`#FBBF24`): pending-review states (a salon awaiting approval, an unresolved report).
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

Same philosophy and reconciliation target as `apps/provider-panel/DESIGN.md`: flat + bordered by default, shadow marks genuine elevation, hue-tinted (never pure black) in dark mode. `--shadow-panel`/`--shadow-pop` should be reconciled onto the same `--shadow-sm`/`--shadow-md`/`--shadow-lg` three-step system.

### Named Rules
**The Elevation-Means-Something Rule** (inherited).

**The Hue-Tinted Shadow Rule** (inherited).

## Shapes

Identical three-step scale: `rounded.full` (pills, badges), `rounded.md`/12px (controls), `rounded.lg`/16px (containers).

### Named Rules
**The Container-Softer-Than-Control Rule** (inherited).

**The No Physical-Direction Leak Rule** (inherited) — check for the same class of bug found in provider-panel's LoginView (a physical `right-`/`left-` class on a positioned icon) during the fix pass; `.app-select`'s own CSS comment already documents an intentional RTL flip for the multiselect arrow, which is correct and should not be "fixed" into a mismatch.

## Components

### Buttons
Same shape/variant contract as the other two apps' Base/App-Button — primary (accent fill, shadow+color hover pairing), secondary (surface-subtle/border-soft fill), danger (danger-strong fill), ghost (transparent, text-muted). No `AppButton.vue` exists yet in this app either — same structural gap as provider-panel had, same fix (build one shared component, migrate hand-rolled markup onto it).

### Status Badge
`StatusBadge.vue` already exists here too (same pattern as provider-panel's) — reuse as-is, on-token.

### Pagination (signature component, admin-panel-specific)
`Pagination.vue` is a genuinely extracted, reusable component — the reference both provider-panel and user-app's per-page hand-rolled pagination buttons should eventually migrate toward, not something to fix here.

### Date Picker (signature component, admin-panel-specific)
`JalaliDatePicker.vue` — a real Jalali-calendar date picker, a genuine capability neither of the other two apps has. Preserve as-is; audit its token usage during the fix pass (radius/shadow/color) but do not rebuild it.

### Cards / Containers
`AppCard.vue` exists, same contract as provider-panel's — `rounded.lg`, bordered, flat shadow at rest.

### Inputs / Fields
No `AppInput.vue` exists yet — same gap, same fix as provider-panel.

## Do's and Don'ts

### Do:
- **Do** treat `apps/user-app/DESIGN.md` as the parent document and `apps/provider-panel/DESIGN.md` as the sibling reference for the identical token-reconciliation fix already proven there.
- **Do** build a shared `AppButton`/`AppInput` and migrate hand-rolled markup onto them, mirroring provider-panel's fix exactly.
- **Do** apply The Uniform Consequence Rule: the same confirm-before-commit weight for money-moving and moderation actions alike.
- **Do** preserve `JalaliDatePicker.vue` and `Pagination.vue` as-is — genuinely good, reusable, on-token components.
- **Do** favor table density over mobile-first card layouts for list screens.

### Don't:
- **Don't** invent a fourth status-tone vocabulary — reuse the warning/info additions provider-panel already established.
- **Don't** soften a destructive or money-moving action's visual weight relative to the other category.
- **Don't** treat this app's current `--color-muted`/`--color-border`/missing-accent-strong state as acceptable — it is the same unreconciled starting point provider-panel had, not a deliberate choice.
- **Don't** add a mobile-first layout pass at the expense of desktop table density — this app's priority order is the inverse of user-app/provider-panel's.
