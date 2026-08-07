# Phase P — AI Readiness Strategy (Draft)

**Status: draft with explicit placeholders, not an approved plan.** Same posture as Phase O: this proposes an approach and flags every decision needing product/business sign-off. Nothing in this phase touched application code.

## 1. Current state (verified, not assumed)

- **No AI/LLM SDK, code, or documentation anywhere in the repo.** No `openai`/`anthropic`/`langchain`/vector-DB client in any app's dependencies; no AI/ML/embedding/recommendation mentions in any existing spec or technical-overview doc.
- **"Featured-boost" search ranking (`search.service.ts`) is plain SQL/app-logic, not ML** — a boolean `is_featured` flag with an admin-set expiry, capped and merged into results. No scoring model, no personalization anywhere in the app.
- **Content moderation is 100% human and reactive** — reviews publish instantly, admins act only after a user report; no profanity filter, spam detector, or fraud heuristic exists anywhere (`docs/technical-overview/23-known-limitations.md`).
- **The platform is pre-launch**, not carrying months of real production data: `MockPaymentGateway` is still the default, real Zarinpal refunds are explicitly "production-unverified," and Phase L's own resource-limit work was described as "not measured against real production traffic." Migration history spans roughly one month of active build work.

This last point matters more than it might first appear: most "AI readiness" advice (recommendation engines, personalization, churn prediction) assumes months of behavioral data to train or tune against. **This platform doesn't have that yet** — Phase O's product-analytics work is the actual prerequisite for most of that category, not this phase.

## 2. A constraint specific to this app that generic AI advice would miss

**Gheychi serves the Iranian market, and the major US-based LLM providers (OpenAI, Anthropic, Google's Gemini API) are, as a matter of policy, generally unavailable to Iranian accounts/IPs under US export-control rules.** This is not a hypothetical — it's the single most important fact shaping any AI vendor decision for this app, and it's the kind of constraint that's easy to miss if "AI readiness" is approached with generic, US-market-default advice (e.g., "just call the OpenAI API"). Concretely, this means:

- Any AI feature that needs to run **server-side, at request time, for end users** (e.g., a live chat-support bot) needs either a self-hosted open-source model, a provider explicitly serving the region, or a proxy/routing layer — not a direct OpenAI/Anthropic API call from `apps/api`.
- Any AI feature that only needs to run **at build/dev time, for the engineering team** (e.g., using an AI coding assistant to help build the app itself — which is, notably, exactly how this production-readiness initiative itself was executed) is a completely different question from what the deployed *product* can call, and isn't blocked by this constraint.
- **[ PLACEHOLDER: confirm current actual access ]** — export-control enforcement and provider policy change over time; this should be verified against each specific provider's current terms before any AI vendor decision is finalized, not assumed permanently true from this document.

## 3. Realistic near-term opportunities that don't require historical data

Given the pre-launch/no-data reality above, the AI opportunities that make sense *now* are ones that don't depend on this app's own behavioral history:

- **Persian-language content moderation assist** — a lightweight classifier (self-hosted or open-weight) flagging likely-spam/abusive review text or blog comments for the existing human admin queue to prioritize, not replace. Fits the existing "reactive, admin-reviewed" moderation posture (Phase M/Q audits already establish this app leans toward augmenting human review, not replacing it, e.g. the existing report-triggered moderation flow) rather than fully automating a decision that currently has real consequences (a wrongly-rejected review, a wrongly-approved abusive one).
- **Search query understanding** — Persian free-text salon/service search could benefit from fuzzy/semantic matching (e.g. a user searching "کوتاهی مو" matching a service literally named "اصلاح مو") beyond today's presumably exact/ILIKE matching in `search.service.ts`. This is closer to a search-relevance improvement than "AI" in the hype sense, and could be evaluated with a small local embedding model without needing any external API or historical usage data.
- **Structured-data extraction for support/operations**, not customer-facing generation — e.g., summarizing an admin's report queue, not writing marketing copy or talking to customers unsupervised.

## 4. What NOT to build yet (and why)

- **Personalized recommendations ("salons like this one," "recommended for you")** — genuinely needs behavioral data this app doesn't have yet. This is squarely blocked on Phase O's analytics work landing and accumulating real usage first, not on this phase.
- **Fully autonomous customer-facing chatbot handling bookings/refunds** — this app's own documented philosophy throughout this session has been "augment human judgment on money-critical and moderation decisions, never fully automate them" (e.g. `AlertsService` pages a human rather than auto-resolving stuck refunds; reviews get a human moderation queue, not auto-approval). An autonomous agent making booking/refund decisions would be a significant philosophical and risk departure from that, not a natural next step.
- **AI-based fraud detection** — no real transaction history yet to model against, and given this handles real payments, a wrong automated fraud call has real business/customer cost. Worth revisiting once real usage data exists.

## 5. PLACEHOLDER — decisions requiring product/business sign-off

- **[ PLACEHOLDER: which opportunity, if any, to prioritize ]** — §3 lists candidates; none are committed. Building any of them is new scope this initiative was not asked to take on.
- **[ PLACEHOLDER: AI vendor/hosting decision ]** — self-hosted open-weight model (adds infra/ops cost, matches this app's existing "self-host everything" posture — SMS/payment/storage/push are all pluggable provider abstractions already) vs. a region-accessible hosted provider, pending §2's access-verification placeholder.
- **[ PLACEHOLDER: budget ]** — inference cost (self-hosted: GPU/compute cost; hosted: per-token cost) at realistic Persian-language moderation/search volume.
- **[ PLACEHOLDER: risk tolerance for automation ]** — even for the "assist, don't replace" framing in §3, someone needs to decide the actual threshold (e.g., does a flagged review get hidden pending review, or just sorted to the top of the queue still-visible?) — a product/legal decision, not an engineering default.
- **[ PLACEHOLDER: data-privacy stance for any user content sent to a third-party model ]** — mirrors Phase O's PII-handling placeholder; review/search text is user-generated content, and sending it to any external API (even a region-accessible one) needs an explicit decision, not a default.

## 6. Actual recommendation for right now

Do not build any AI feature yet. The two genuinely useful things this phase's research surfaces are: (1) the export-control constraint in §2, which should inform *any* future AI discussion so it doesn't default to "just use OpenAI"; and (2) the explicit dependency on Phase O's analytics work landing first for the highest-value opportunities (personalization, recommendations). Revisit this document once Phase O has shipped and accumulated a few months of real usage data.
