import { describe, it, expect } from 'vitest'
import { LEGAL_DOCUMENTS } from '../../app/content/legal'
import { resolveLegalDocument, type LegalContext } from '../../app/utils/legal-render'

// These run against the REAL legal copy (the page specs use a small fixture), so a typo'd token or a
// section that renders as an empty heading is caught here instead of on a live legal page.
const FULL: LegalContext = {
  paymentsOn: true,
  terms: { depositPercent: 20, depositMinToman: 200000, cancellationWindowHours: 24 },
  operator: { name: 'شرکت نمونه', email: 'a@b.ir', phone: '02112345678', address: 'تهران', registration: '123' },
}
const BARE: LegalContext = { paymentsOn: false, terms: null, operator: {} }
const slugs = Object.keys(LEGAL_DOCUMENTS) as Array<keyof typeof LEGAL_DOCUMENTS>

function allText(doc: ReturnType<typeof resolveLegalDocument>): string {
  return [doc.title, doc.intro, ...doc.sections.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => ('items' in b ? b.items : [b.text]))])].join('\n')
}

describe('legal content (real copy)', () => {
  it('has the three documents with matching slugs and ISO dates', () => {
    expect(slugs.sort()).toEqual(['booking-policy', 'privacy', 'terms'])
    for (const s of slugs) {
      expect(LEGAL_DOCUMENTS[s].slug).toBe(s)
      expect(LEGAL_DOCUMENTS[s].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('uses unique, URL-safe section ids per document', () => {
    for (const s of slugs) {
      const ids = LEGAL_DOCUMENTS[s].sections.map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  for (const mode of [{ name: 'payments off', on: false }, { name: 'payments on', on: true }]) {
    it(`never leaks a raw {{token}} or a placeholder (${mode.name}, every operator/terms combination)`, () => {
      for (const s of slugs) {
        for (const ctx of [{ ...FULL, paymentsOn: mode.on }, { ...BARE, paymentsOn: mode.on }, { ...FULL, paymentsOn: mode.on, terms: null }, { ...FULL, paymentsOn: mode.on, operator: {} }]) {
          const text = allText(resolveLegalDocument(LEGAL_DOCUMENTS[s], ctx))
          expect(text).not.toMatch(/\{\{|\}\}/)
          expect(text).not.toMatch(/undefined|null|NaN/)
        }
      }
    })
  }

  it('renders no empty sections and keeps every section heading with content', () => {
    for (const s of slugs) {
      for (const ctx of [FULL, BARE]) {
        const doc = resolveLegalDocument(LEGAL_DOCUMENTS[s], ctx)
        expect(doc.sections.length).toBeGreaterThan(2)
        for (const sec of doc.sections) expect(sec.blocks.length).toBeGreaterThan(0)
      }
    }
  })

  it('states the live booking numbers (Persian digits) only when they could be fetched', () => {
    const on = allText(resolveLegalDocument(LEGAL_DOCUMENTS['booking-policy'], FULL))
    expect(on).toContain('۲۴ ساعت')
    expect(on).toContain('۲۰٪')
    expect(on).toContain('بیعانه')
    const off = allText(resolveLegalDocument(LEGAL_DOCUMENTS['booking-policy'], { ...FULL, terms: null }))
    expect(off).not.toMatch(/۲۴ ساعت|۲۰٪/)
  })

  it('describes deposits as collected only while online payment is on', () => {
    const offText = allText(resolveLegalDocument(LEGAL_DOCUMENTS['booking-policy'], { ...FULL, paymentsOn: false }))
    expect(offText).toContain('هیچ بیعانه‌ای دریافت نمی‌شود')
    expect(offText).not.toContain('بیعانه بازگردانده نمی‌شود')
    const onText = allText(resolveLegalDocument(LEGAL_DOCUMENTS['booking-policy'], { ...FULL, paymentsOn: true }))
    expect(onText).toContain('بیعانه')
    expect(onText).not.toContain('هیچ بیعانه‌ای دریافت نمی‌شود')
  })

  it('uses the glossary terms: بیعانه, never پیش‌پرداخت or the verified-salon claim', () => {
    for (const s of slugs) {
      const text = allText(resolveLegalDocument(LEGAL_DOCUMENTS[s], { ...FULL, paymentsOn: true }))
      expect(text).not.toContain('پیش‌پرداخت')
      expect(text).not.toContain('سالن تایید شده')
      expect(text).not.toContain('آرایشگاه')
    }
  })

  it('omits the operator contact lines (not the whole page) when the operator is unconfigured', () => {
    const bare = allText(resolveLegalDocument(LEGAL_DOCUMENTS.terms, BARE))
    expect(bare).not.toContain('ایمیل:')
    expect(bare).not.toContain('ارتباط با ما') // the whole empty section goes, not a heading over nothing
    expect(bare).not.toContain('راه‌های زیر')
    expect(bare).toContain('شرایط استفاده')
    const full = allText(resolveLegalDocument(LEGAL_DOCUMENTS.terms, FULL))
    expect(full).toContain('ایمیل: a@b.ir')
  })
})
