# قیچی brand tokens (canonical — identical values in all three apps)

Source: supplied brand sheet (blush #F7E6E2, peach #FFC0B6, gold #D4AF37, silver #BDBDBD, white, charcoal #2D2D2D).
Contrast verified (WCAG 2.x). Map these onto each app's EXISTING token names in its main.css (do not rename
tokens that components already use; add missing ones). Keep the existing dark-mode mechanism (.dark class).

## Light
| role | value | notes / verified contrast |
|---|---|---|
| page background (--color-surface / bg) | #FBF5F3 | blush tint; charcoal text 12.76 |
| card / raised surface | #FFFFFF | |
| subtle surface (section bg, chips, placeholders) | #F7E6E2 | brand blush; charcoal 11.39, muted text 6.00 |
| primary text | #2D2D2D | brand charcoal; 13.77 on white |
| muted text | #5E5552 | 7.25 white / 6.72 page / 6.00 blush |
| accent FILL (primary buttons, selected chips, active nav bg) | #FFC0B6 | brand peach; ALWAYS charcoal text on it (8.83). Never white text on peach (1.56 FAIL) |
| accent fill hover/pressed | #FFAD9F | charcoal 7.69 |
| accent soft (tinted bg, active nav item bg) | #FFE3DD | |
| accent TEXT (links, icon accents, focus ring) | #A8473A | 5.79 white / 5.36 page / 4.79 blush |
| accent text strong (on blush where 4.79 is too tight for small text) | #94392D | 6.03 on blush |
| gold FILL (premium/plan/featured badges) | #D4AF37 | charcoal text 6.55. Use sparingly |
| gold TEXT | #7A5F0E | 6.05 white / 5.61 page. Never #D4AF37 as text on light (2.10 FAIL) |
| silver (decorative dividers/hairlines only) | #BDBDBD | 1.88 — NOT for text or input borders |
| input / control border (WCAG 1.4.11 ≥3:1) | #8C8280 | 3.74 white / 3.46 page |
| soft border (cards, separators) | #EADBD6 | decorative |
| success text / fill-text | #2E7D4F | 5.05 white |
| warning text | #8A5A00 | 5.93 |
| danger text | #B42318 | 6.57 |
| info text | #1F5F99 | 6.66 |
| mascot tile background (pose images are on this exact color) | #FBF6F2 | REQUIRED container bg for /mascot/*.webp tiles |

## Dark
| role | value |
|---|---|
| page bg | #1F1C1B |
| card | #2A2625 |
| subtle | #342F2D |
| text | #F3ECEA (14.5) |
| muted text | #B8ADA9 (6.84 on card) |
| accent fill | #FFC0B6 with #2D2D2D text |
| accent text | #FFC0B6 (9.60 on card) |
| gold text | #D4AF37 (7.12 on card) |
| control border | #7A6F6C |
| mascot tile | keep #FBF6F2 tile (it is an image background) inside a rounded container — fine on dark |

## Radii / elevation / motion
- radius: controls 12px, cards 16px, sheets/modals 20px, pills 9999px.
- elevation: subtle warm shadow rgba(45,45,45,.06) for cards; stronger only for overlays.
- motion: 150–220ms ease-out for small UI; drawers 220ms; NO out-in route transitions (blank lazy pages — documented); respect prefers-reduced-motion (existing global kill-switch stays).

## Typography
- Vazirmatn (already self-hosted, OFL). IRANYekanX is NOT licensed in repo → do not add.
- Persian digits for all user-visible numbers (fa-IR), tabular nums for money/time.

## Mascot assets (already copied into every app's public/)
- /mascot-full.webp (+ .png fallback): waving full character, transparent, 501x900 — login hero, large empty/hero moments.
- /brand-icon.png: face logo mark (opaque square tile) — headers, small brand lockups, favicon/PWA.
- /mascot/{hello,happy,excited,thinking,curious,wink,calendar,phone,done}.webp: ~210px square tiles cropped at native
  resolution from the official brand sheet, on #FBF6F2. Display ≤ 112px CSS (never upscale beyond ~1x of 210px@2x),
  always inside a container with background #FBF6F2 and rounded corners (e.g. rounded-3xl) so edges are seamless.
  Uses: hello=welcome/onboarding, happy=positive empty states, thinking=loading/analysis (Beauty Guide), curious=no
  results/search empty, calendar=no appointments / schedule empty, phone=SMS/contact contexts, done=booking success,
  excited/wink=sparingly for celebrations. Never as functional icons; never on every card; admin tables use icons not mascots.
- Brand name: Persian «قیچی» in all Persian UI/metadata; Latin «Gheychi» only in Latin wordmark contexts.
