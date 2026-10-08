import { formatToman } from './format-toman'

// Structurally identical to the exported types of app/content/legal.ts (the copy is authored
// there); declared here so this renderer has no dependency on the copy itself and can be
// tested with a tiny fixture.
export type LegalCondition = 'paymentsOn' | 'paymentsOff'
export type LegalBlock =
  | { type: 'p'; text: string; when?: LegalCondition }
  | { type: 'ul'; items: string[]; when?: LegalCondition }
  | { type: 'note'; text: string; when?: LegalCondition }
export interface LegalSection { id: string; title: string; blocks: LegalBlock[] }
export interface LegalDocument {
  slug: string
  title: string
  description: string
  updatedAt: string
  intro: string
  sections: LegalSection[]
}

export interface BookingTermsValues {
  depositPercent: number
  depositMinToman: number
  cancellationWindowHours: number
}

export interface LegalOperator {
  name?: string
  email?: string
  phone?: string
  address?: string
  registration?: string
}

export interface LegalContext {
  paymentsOn: boolean
  /** null when /platform-config/booking-terms failed: numeric blocks are dropped, never guessed. */
  terms: BookingTermsValues | null
  operator: LegalOperator
}

export type ResolvedLegalBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'note'; text: string }
export interface ResolvedLegalSection { id: string; title: string; number: string; blocks: ResolvedLegalBlock[] }
export interface ResolvedLegalDocument {
  title: string
  description: string
  updatedAt: string
  intro: string
  sections: ResolvedLegalSection[]
}

const TOKEN = /\{\{\s*([A-Za-z]+)\s*\}\}/g

function tokenValues(ctx: LegalContext): Record<string, string | undefined> {
  const op = (v?: string) => (v?.trim() ? v.trim() : undefined)
  return {
    depositPercent: ctx.terms ? ctx.terms.depositPercent.toLocaleString('fa-IR') : undefined,
    depositMinToman: ctx.terms ? formatToman(ctx.terms.depositMinToman) : undefined,
    cancellationWindowHours: ctx.terms ? ctx.terms.cancellationWindowHours.toLocaleString('fa-IR') : undefined,
    operatorName: op(ctx.operator.name),
    operatorEmail: op(ctx.operator.email),
    operatorPhone: op(ctx.operator.phone),
    operatorAddress: op(ctx.operator.address),
    operatorRegistration: op(ctx.operator.registration),
  }
}

/**
 * Substitutes tokens in one string. Returns null when ANY token in it is unknown or has no
 * value, so the caller omits that text entirely: a legal page must never show a raw
 * `{{token}}`, a placeholder, or a number we could not fetch.
 */
export function substituteTokens(text: string, ctx: LegalContext): string | null {
  const values = tokenValues(ctx)
  let ok = true
  const out = text.replace(TOKEN, (_m, name: string) => {
    if (!Object.hasOwn(values, name)) {
      if (import.meta.dev) console.warn(`[legal] unknown token {{${name}}} -- block dropped`)
      ok = false
      return ''
    }
    const v = values[name]
    if (v === undefined) {
      ok = false
      return ''
    }
    return v
  })
  return ok ? out : null
}

function conditionHolds(when: LegalCondition | undefined, ctx: LegalContext): boolean {
  if (!when) return true
  return when === 'paymentsOn' ? ctx.paymentsOn : !ctx.paymentsOn
}

function resolveBlock(block: LegalBlock, ctx: LegalContext): ResolvedLegalBlock | null {
  if (!conditionHolds(block.when, ctx)) return null
  if (block.type === 'ul') {
    // Per item: a contact list should lose only the line whose value is unset.
    const items = block.items.map((i) => substituteTokens(i, ctx)).filter((i): i is string => i !== null)
    return items.length ? { type: 'ul', items } : null
  }
  const text = substituteTokens(block.text, ctx)
  return text === null ? null : { type: block.type, text }
}

const sectionNumber = (n: number) => n.toLocaleString('fa-IR')

export function resolveLegalDocument(doc: LegalDocument, ctx: LegalContext): ResolvedLegalDocument {
  const sections: ResolvedLegalSection[] = []
  for (const section of doc.sections) {
    const blocks = section.blocks.map((b) => resolveBlock(b, ctx)).filter((b): b is ResolvedLegalBlock => b !== null)
    // A heading with nothing under it is noise (and would be a numbered gap in the TOC).
    if (!blocks.length) continue
    sections.push({ id: section.id, title: section.title, number: sectionNumber(sections.length + 1), blocks })
  }
  return {
    title: doc.title,
    description: doc.description,
    updatedAt: doc.updatedAt,
    intro: substituteTokens(doc.intro, ctx) ?? '',
    sections,
  }
}
