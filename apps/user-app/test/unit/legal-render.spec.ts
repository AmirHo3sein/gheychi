import { describe, it, expect } from 'vitest'
import {
  resolveLegalDocument,
  substituteTokens,
  type LegalContext,
  type LegalDocument,
} from '../../app/utils/legal-render'

const CTX: LegalContext = {
  paymentsOn: false,
  terms: { depositPercent: 20, depositMinToman: 50000, cancellationWindowHours: 24 },
  operator: { name: 'شرکت نمونه', email: 'a@b.ir' },
}

const DOC: LegalDocument = {
  slug: 'terms',
  title: 'عنوان',
  description: 'توضیح',
  updatedAt: '2026-10-08',
  intro: 'مقدمه',
  sections: [
    {
      id: 'one',
      title: 'اول',
      blocks: [
        { type: 'p', text: 'بیعانه {{depositPercent}} درصد است.' },
        { type: 'p', text: 'فقط وقتی پرداخت روشن است', when: 'paymentsOn' },
        { type: 'p', text: 'فقط وقتی پرداخت خاموش است', when: 'paymentsOff' },
      ],
    },
    { id: 'two', title: 'دوم', blocks: [{ type: 'p', text: 'آدرس: {{operatorAddress}}' }] },
    {
      id: 'three',
      title: 'سوم',
      blocks: [
        { type: 'ul', items: ['نام: {{operatorName}}', 'تلفن: {{operatorPhone}}', 'ایمیل: {{operatorEmail}}'] },
        { type: 'note', text: 'یادداشت {{nope}}' },
      ],
    },
  ],
}

describe('substituteTokens', () => {
  it('substitutes with fa-IR digits and the repo toman formatter', () => {
    expect(substituteTokens('{{depositPercent}}٪ از {{depositMinToman}} با {{cancellationWindowHours}} ساعت', CTX)).toBe(
      `${(20).toLocaleString('fa-IR')}٪ از ${(50000).toLocaleString('fa-IR')} با ${(24).toLocaleString('fa-IR')} ساعت`,
    )
  })

  it('returns null for an unset operator token, an unknown token, or numbers that could not be fetched', () => {
    expect(substituteTokens('{{operatorPhone}}', CTX)).toBeNull()
    expect(substituteTokens('{{operatorName}} {{operatorPhone}}', CTX)).toBeNull()
    expect(substituteTokens('{{whatever}}', CTX)).toBeNull()
    expect(substituteTokens('{{depositPercent}}', { ...CTX, terms: null })).toBeNull()
  })

  it('treats a whitespace-only operator value as unset', () => {
    expect(substituteTokens('{{operatorName}}', { ...CTX, operator: { name: '   ' } })).toBeNull()
  })

  it('leaves token-free text untouched', () => {
    expect(substituteTokens('متن ساده', CTX)).toBe('متن ساده')
  })
})

describe('resolveLegalDocument', () => {
  it('honours `when` against the payments flag', () => {
    const off = resolveLegalDocument(DOC, CTX).sections[0]!.blocks.map((b) => (b as { text: string }).text)
    expect(off.some((t) => t.includes('خاموش'))).toBe(true)
    expect(off.some((t) => t.includes('روشن'))).toBe(false)

    const on = resolveLegalDocument(DOC, { ...CTX, paymentsOn: true }).sections[0]!.blocks.map((b) => (b as { text: string }).text)
    expect(on.some((t) => t.includes('روشن'))).toBe(true)
    expect(on.some((t) => t.includes('خاموش'))).toBe(false)
  })

  it('omits blocks with unset operator tokens, drops empty sections, and renumbers', () => {
    const doc = resolveLegalDocument(DOC, CTX)
    // «دوم» only had the unset address -> gone; «سوم» becomes section 2.
    expect(doc.sections.map((s) => [s.id, s.number])).toEqual([
      ['one', (1).toLocaleString('fa-IR')],
      ['three', (2).toLocaleString('fa-IR')],
    ])
  })

  it('drops only the unset lines of a list and never lets a raw token reach the output', () => {
    const doc = resolveLegalDocument(DOC, CTX)
    const list = doc.sections[1]!.blocks[0]!
    expect(list).toEqual({ type: 'ul', items: ['نام: شرکت نمونه', 'ایمیل: a@b.ir'] })
    expect(JSON.stringify(doc)).not.toContain('{{')
  })

  it('drops numeric blocks entirely when the booking terms are unavailable', () => {
    const doc = resolveLegalDocument(DOC, { ...CTX, terms: null })
    expect(JSON.stringify(doc)).not.toContain('درصد')
  })

  it('keeps an intro with an unresolvable token out of the page', () => {
    expect(resolveLegalDocument({ ...DOC, intro: 'سلام {{operatorPhone}}' }, CTX).intro).toBe('')
  })
})
