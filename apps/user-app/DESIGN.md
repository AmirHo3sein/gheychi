---
name: Gheychi
description: A trust-first Persian/RTL salon-booking marketplace — precise, verified, quietly official.
colors:
  surface: "#F4FBFA"
  surface-dark: "#151217"
  surface-card: "#FFFFFF"
  surface-card-dark: "#211D24"
  surface-subtle: "#EAF5F3"
  surface-subtle-dark: "#2A2530"
  text: "#0B4F4A"
  text-dark: "#F5F0F2"
  text-muted: "#5B8783"
  text-muted-dark: "#B3A3B0"
  border: "#DCEDEA"
  border-dark: "#38323D"
  accent-teal: "#0EA89B"
  accent-teal-strong: "#0C8F84"
  accent-teal-soft: "#E3F6F3"
  accent-violet: "#7A3FF2"
  accent-violet-strong: "#9463F5"
  accent-violet-soft: "#2C2140"
  ad-orange: "#FF7A45"
  ad-pink: "#F24F8D"
  danger: "#DC4747"
  danger-dark: "#F2645C"
  danger-soft: "#FCEAEA"
  danger-soft-dark: "#3A2229"
  success: "#1E9E6B"
  success-dark: "#3FC98A"
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
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
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
---

# Design System: Gheychi

## Overview

**Creative North Star: "The Verified Ledger"**

Gheychi's job is to make trust legible at a glance — a review only exists because a booking actually happened, a deposit is real money already moving, a salon only appears because a human already checked it. The visual system should read the same way: precise, confident, and quietly official, like a stamped receipt rather than a marketing flyer. Color is used deliberately and sparingly — the accent appears as a seal of approval on the one thing that matters on a given screen (the primary action, the verified badge, the price that's about to be charged), not as ambient decoration. Edges are clean and deliberate; nothing about the interface should feel soft, vague, or negotiable, because the product itself isn't.

This is a mobile-first system, built for budget Android hardware and unreliable networks, not a demo device. It avoids the generic AI-SaaS tells on sight: no Inter, no purple-to-blue gradients, no cards nested in cards, no rounded-square icon tile floating above every heading. Vazirmatn — a real, Persian-native variable typeface — carries the whole system; there is no secondary display or mono face standing in for character. RTL is the only reading direction this system knows; logical properties (`start-`/`end-`/`ps-`/`pe-`) are load-bearing, not optional polish.

**This document canonizes the system as built in `login.vue` and the `Base*` component library** (`app/components/ui/`) as the standard for the whole app going forward. Several older surfaces — `index.vue`, `AppHeader.vue`, `ThemeToggle.vue`, `ToastStack.vue`, and several `salon/*` components (`SalonCard.vue`, `SalonReviews.vue`, `SalonTeam.vue`, `ReportForm.vue`, `SlotPicker.vue`) — predate this system and do not yet comply with it (flat surfaces with no shadow token, `rounded-lg` instead of the `md`/`lg` scale below, emoji glyphs standing in for icons that already exist in `BaseIcon`). They are named explicitly here as **due for migration**, not as an equally valid alternative style. `index.vue` in particular is the app's actual most-seen screen for a logged-in user and its current bare, unstyled state is the single largest gap between what this document specifies and what ships today.

**Key Characteristics:**
- A two-mode identity that fully re-themes, not just inverts: light is teal-accented ("Certified Teal"), dark is violet-accented ("Notarized Violet") — the hue itself changes, signaling a genuinely different mode, not a dimmed copy.
- Restrained, purposeful shadow use — elevation is a deliberate signal (a real card, a raised primary action), never ambient texture.
- Tactile, precise interaction: buttons compress slightly on press, hover deepens shadow and color together, focus rings are exact and confident.
- One typeface, one accent per mode, a tight neutral scale — the system earns clarity through restraint, not variety.

## Colors

A tight, functional palette: one accent per mode, a warm-neutral surface scale, and two semantic states (danger, success) plus one commercial signal (the "ad"/featured badge). Every color re-themes between light and dark — there is no shared, mode-agnostic color in this system except pure white text-on-accent.

### Primary
- **Certified Teal** (`#0EA89B`, light mode) / **Notarized Violet** (`#7A3FF2`, dark mode): the one interactive/brand signal in the system — primary buttons, active states, focus rings, links, the story-ring gradient's leading edge. Used on a deliberately small fraction of any given screen; its rarity is what makes it read as a seal of approval rather than paint.
- **Accent Strong** (`#0C8F84` light / `#9463F5` dark): hover/active state for the accent — always paired with a shadow-depth increase (`shadow-sm` → `shadow-md`) on the primary button, never a color shift alone.
- **Accent Soft** (`#E3F6F3` light / `#2C2140` dark): accent-tinted fill for badges, selected chips, and low-emphasis accent surfaces where the full-strength accent would be too loud.

### Secondary
- **Ad Orange** (`#FF7A45`, light) / **Ad Pink** (`#F24F8D`, dark): reserved exclusively for the "featured/ad-boosted" salon badge — the one place this system intentionally signals "paid placement," kept visually distinct from the trust-accent so a user never confuses sponsorship with verification.

### Neutral
- **Surface** (`#F4FBFA` light / `#151217` dark): the page background — a warm off-white in light mode, a near-black with a faint warm/violet cast in dark mode (never a true, cold `#000`).
- **Surface Card** (`#FFFFFF` light / `#211D24` dark): elevated container background — cards, inputs, the form panel.
- **Surface Subtle** (`#EAF5F3` light / `#2A2530` dark): recessed fill — secondary buttons, hover backgrounds, the theme-toggle track.
- **Text** (`#0B4F4A` light / `#F5F0F2` dark): primary text — notably not pure black or pure white; light mode's text carries a deep teal cast, tying body copy back to the brand hue even at rest.
- **Text Muted** (`#5B8783` light / `#B3A3B0` dark): secondary text, labels, placeholders, helper copy.
- **Border** (`#DCEDEA` light / `#38323D` dark): the default hairline — used for card outlines and input borders at rest.

### Semantic
- **Danger** (`#DC4747` light / `#F2645C` dark), with **Danger Soft** (`#FCEAEA` / `#3A2229`) as its tinted-background counterpart: errors, destructive actions, validation failures.
- **Success** (`#1E9E6B` light / `#3FC98A` dark): confirmation states.

### Named Rules
**The One Seal Rule.** The accent color appears on the single most important element of a screen — the primary action, the verified badge, the thing the user is here to do — never spread across navigation, backgrounds, or secondary controls. If more than one element on a screen is accent-colored, something has drifted from the system.

**The No Mode-Agnostic Color Rule.** Every color in this system (except white text-on-accent) has a distinct light and dark value, defined by re-theming, not by inverting lightness alone. A new color token must ship with both.

## Typography

**Body Font:** Vazirmatn Variable (with `ui-sans-serif, system-ui, sans-serif` fallback)

**Character:** A single, warm, technically precise Persian-native variable typeface carries the entire system — no secondary display or mono face. Weight does the work of hierarchy; there is currently no size step larger than the login hero headline, which is a deliberate restraint, not a gap.

### Hierarchy
- **Headline** (700, 1.875rem/30px, 1.6 line-height): the one large-scale moment in the system today — `login.vue`'s brand-panel hero copy. Reserve for the rare screen that needs to persuade rather than operate (marketing-adjacent moments), not for routine page titles.
- **Title** (700, 1.25rem/20px, 1.4 line-height): step/section headers within a flow — e.g. login's per-step `<h1>`. This is the workhorse "this is where you are" heading size; `index.vue` and most other screens currently have no heading at this level at all and should.
- **Body** (400, 1rem/16px, 1.6 line-height): default reading size — page copy, descriptions.
- **Label** (500, 0.875rem/14px, 1.4 line-height): form labels, secondary buttons, compact UI text — the single most-used text size in the app today.
- **Caption** (400, 0.75rem/12px, 1.4 line-height): helper text, inline validation messages, timestamps.

### Named Rules
**The Weight-Over-Size Rule.** Prefer stepping weight (500 → 700) before reaching for a larger size to establish hierarchy on a dense, mobile-first screen — this system has exactly five size steps and should not casually add a sixth.

## Layout

Mobile-first, single-column by default, with one deliberate desktop expansion pattern established in `login.vue`: a `lg:flex` split panel (brand/marketing half + centered `max-w-sm` form half), collapsing to a single centered column below `lg`. This is the reference pattern for any future full-page (non-app-chrome) flow — not every screen needs it, but any screen that does should use exactly this breakpoint and ratio rather than inventing a new one.

Spacing rhythm is tight and consistent: `8px` (`spacing.sm`) is the resting gap between related inline elements (icon-to-label, pill groups); `16px` (`spacing.md`) is the standard card/section internal padding; `24px`–`32px` (`spacing.lg`/`xl`) mark a deliberate section break, used sparingly (e.g. `BaseCard`'s `lg` padding variant, the login brand panel). Density should stay high — this is a mobile utility app, not an editorial spread; generous whitespace is reserved for the few screens (like the login hero) that are explicitly persuading rather than operating.

### Named Rules
**The Density-First Rule.** Default to compact spacing (`spacing.sm`/`md`); reach for `lg`/`xl` only for an explicit section break or a Persuade-mode moment, never as the resting state of an Operate-mode screen (booking flow, account pages, lists).

## Elevation & Depth

Shadows are a deliberate, sparingly-used signal, not ambient texture — only 4 shadow usages exist across the entire current component set. A flat, bordered surface (`border-(--color-border)`, no shadow) is the default resting state for most containers; a shadow is added only to mark genuine elevation: a raised card floating above the page (`BaseCard`), or a primary action that should feel physically pressable (`BaseButton`'s primary variant, whose shadow visibly deepens sm→md on hover, paired with the color darkening — elevation and emphasis move together, never independently).

Shadows are hue-tinted, not neutral black — `--shadow-color` is `178° 45% 20%` (a dark teal) in light mode and `275° 55% 4%` (a near-black violet) in dark mode, so even a shadow carries the mode's accent identity at a glance. Dark-mode shadows use roughly 2–3× the opacity of their light-mode counterparts, compensating for reduced contrast against a dark surface.

### Shadow Vocabulary
- **`shadow.sm`** (`0 1px 2px hsl(var(--shadow-color)/0.06), 0 1px 1px hsl(var(--shadow-color)/0.04)` light; `/0.4, /0.3` dark): resting elevation for a card or the primary button at rest.
- **`shadow.md`** (`0 8px 24px -8px hsl(var(--shadow-color)/0.16), 0 2px 6px -2px hsl(var(--shadow-color)/0.08)` light; `/0.55, /0.4` dark): hover/emphasis elevation — currently only the primary button's hover state.
- **`shadow.lg`** (`0 24px 48px -16px hsl(var(--shadow-color)/0.22), 0 8px 16px -4px hsl(var(--shadow-color)/0.1)` light; `/0.65, /0.5` dark): reserved for the highest-elevation surface in a view (a modal, a sheet) — defined but not yet used anywhere; the next surface that needs a floating/modal treatment should reach for this rather than an ad hoc `shadow-lg` Tailwind default (as `ToastStack.vue` currently does, a token-bypass to fix during migration).

### Named Rules
**The Elevation-Means-Something Rule.** A shadow is never decorative. If a surface doesn't need to visually separate from its background or signal "this is the important, pressable thing," it gets a border, not a shadow.

## Shapes

Three-step radius scale, mapped to a clear size hierarchy — the larger the surface, the larger the radius:
- **`rounded.full`** (`9999px`): pills, avatars, badges, icon buttons, the step-progress-bar segments — anything small and either circular or explicitly pill-shaped.
- **`rounded.md`** (`12px`): interactive controls — buttons, inputs, selects. This is the system's "you can act on this" radius.
- **`rounded.lg`** (`16px`): containers — cards, panels. One step softer than controls, marking "this holds content" rather than "this does something."

### Named Rules
**The Container-Softer-Than-Control Rule.** A container's radius is always one step larger than the radius of the controls it contains — never equal, never smaller. `BaseCard` at `16px` holding `BaseButton`/`BaseInput` at `12px` is the reference relationship.

**The No Physical-Direction Leak Rule.** Every positioned element uses logical properties (`start-`/`end-`/`ps-`/`pe-`), never `left`/`right`, in an RTL-only system. `BaseSelect.vue`'s custom chevron currently violates this (`background-position: left 0.9rem center`, plus a hardcoded light-mode hex baked into its SVG data URI that never adapts to dark mode) — a confirmed defect to fix during the next pass on that component, not a pattern to repeat.

## Components

### Buttons
- **Shape:** `rounded.md` (12px), uniform across all four variants and both sizes.
- **Primary:** accent background, white text, `shadow.sm` at rest → `shadow.md` + `accent-strong` background on hover. The only variant with a resting shadow — reserve for the one primary action per screen.
- **Secondary:** `surface-subtle` background, `text` color, hover to `border` color — for the second-priority action alongside a primary.
- **Ghost:** transparent, `text-muted` color, hover to `surface-subtle` fill + `text` color — for tertiary/dismissive actions.
- **Danger:** `danger` background, white text, hover opacity 90% — destructive actions only.
- **States:** disabled = 60% opacity + no press-scale; loading = spinner replaces the leading icon slot, label stays visible; press = `scale(0.98)` on `:active`, a 150ms `transition-all` covering color, shadow, and transform together.

### Cards / Containers
- **Corner Style:** `rounded.lg` (16px).
- **Background:** `surface-card`.
- **Shadow Strategy:** `shadow.sm` at rest, static (no hover shadow change — cards are containers, not actions).
- **Border:** 1px `border` color, always present alongside the shadow (never shadow-only).
- **Internal Padding:** `spacing.md` (16px) default; `spacing.lg`–`xl` (24–32px, responsive) for the "lg" variant used on primary flows like login.

### Inputs / Fields
- **Style:** `rounded.md` (12px), `surface-card` background, `border` at rest.
- **Focus:** border shifts to accent + a 30%-opacity accent ring (`ring-2 ring-(--color-accent)/30`) — never a bare browser outline.
- **Error:** border and focus-ring both shift to `danger`; a caption-sized error message with an alert icon appears below, left-aligned to the field.
- **Icon-prefixed variant:** icon absolutely positioned at the logical `start`, field padding becomes asymmetric to make room — never a symmetric padding hack.
- **Center-aligned variant:** used specifically for fixed-length codes (OTP), wide letter-spacing (`0.4em`) makes each digit distinct.

### Navigation
Not yet systematized — `AppHeader.vue` is flagged for migration (see Overview). The reference pattern to migrate toward, established by `login.vue`'s brand mark: a `rounded.md` icon badge (accent background, white icon) paired with a bold wordmark, rather than the current bare-text header with no icon mark and an emoji-based theme toggle (`ThemeToggle.vue` should use `BaseIcon`'s existing `sun`/`moon` icons, not `☀️`/`🌙`/`💻` glyphs).

### Step Indicator (signature component)
A thin segmented progress bar (`h-1.5`, `rounded.full` per segment, `spacing.sm`-scale gap between segments) — filled segments use the accent color, unfilled use `border`. Established in `login.vue`'s multi-step flow; the reference pattern for any future multi-step process in the app (onboarding, checkout) rather than a numbered-dots or linear-percentage-bar alternative.

## Do's and Don'ts

### Do:
- **Do** compose `BaseButton`/`BaseInput`/`BaseCard`/`BaseSelect`/`BaseIcon` for any new UI rather than hand-rolling equivalent markup — `ReportForm.vue`'s raw `<textarea>` and hand-rolled submit button are the pattern to avoid, not follow.
- **Do** use `BaseIcon`'s existing SVG icon set (`sun`, `moon`, `star`, `flag`, etc.) instead of emoji glyphs, even where an emoji "already works" — `ThemeToggle.vue`, `SalonReviews.vue`, and `SalonTeam.vue`'s emoji usage are migration targets, confirmed by icons that already exist in `BaseIcon` going unused.
- **Do** define both a light and dark value for any new color token — never ship a token that only "happens to work" in one mode.
- **Do** use logical CSS properties (`start-`/`end-`/`ps-`/`pe-`/`ms-`/`me-`) for any positioned or asymmetrically-padded element.
- **Do** pair a shadow-depth change with a color change on hover for any primary/emphasis interactive element (never shadow-only or color-only).

### Don't:
- **Don't** add a second accent color or use the accent on more than one element's worth of emphasis per screen (The One Seal Rule).
- **Don't** use `rounded-lg` (8px) on a new component — the system's control/container radii are `12px`/`16px`; `8px` only appears in not-yet-migrated old code.
- **Don't** add ambient/decorative shadows to a static, non-elevated surface — flat + bordered is the correct default (The Elevation-Means-Something Rule).
- **Don't** hardcode a hex color inside an inline `style` or SVG data URI (as `BaseSelect.vue`'s chevron currently does) — reference the CSS custom property so both themes stay correct.
- **Don't** treat `index.vue` or `AppHeader.vue`'s current styling as a valid reference for new work — they predate this system and are documented here specifically as migration targets.
