import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GuideConceptList from '../../app/components/beauty-guide/GuideConceptList.vue'
import type { GuideConcept } from '../../app/utils/beauty-guide'

const c = (over: Partial<GuideConcept>): GuideConcept => ({
  key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', domain: 'hair_color', confidence: 'high', source: 'ai',
  removed: false, evidenceFa: null, mappable: true, ...over,
})
const VOCAB = [
  { key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', domain: 'hair_color' },
  { key: 'highlights', nameFa: 'هایلایت', nameEn: 'Highlights', domain: 'hair_color' },
  { key: 'almond_shape', nameFa: 'فرم بادامی', nameEn: 'Almond Shape', domain: 'nails' },
]

describe('GuideConceptList', () => {
  it('shows hedged confidence words and never a raw score', async () => {
    const wrapper = await mountSuspended(GuideConceptList, {
      props: { concepts: [c({}), c({ key: 'root_melt', nameFa: 'روت ملت', nameEn: 'Root Melt', confidence: 'medium' })], vocabulary: VOCAB, domain: 'hair_color' },
    })
    expect(wrapper.get('[data-testid="concept-balayage"]').text()).toContain('به احتمال زیاد')
    expect(wrapper.get('[data-testid="concept-balayage"]').text()).toContain('بالیاژ (Balayage)')
    expect(wrapper.get('[data-testid="concept-root_melt"]').text()).toContain('احتمالاً')
    expect(wrapper.text()).not.toMatch(/0\.\d/)
  })

  it('emits remove, and lets a removed concept be restored', async () => {
    const wrapper = await mountSuspended(GuideConceptList, {
      props: { concepts: [c({}), c({ key: 'root_melt', nameFa: 'روت ملت', removed: true })], vocabulary: VOCAB, domain: 'hair_color' },
    })
    await wrapper.get('[data-testid="concept-balayage"] [data-testid="concept-remove"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['balayage']])
    await wrapper.get('[data-testid="concept-restore-root_melt"]').trigger('click')
    expect(wrapper.emitted('restore')).toEqual([['root_melt']])
  })

  it('marks a low-confidence guess as not used for matching until confirmed', async () => {
    const wrapper = await mountSuspended(GuideConceptList, {
      props: { concepts: [c({ key: 'highlights', nameFa: 'هایلایت', confidence: 'low' })], vocabulary: VOCAB, domain: 'hair_color' },
    })
    const card = wrapper.get('[data-testid="concept-highlights"]')
    expect(card.text()).toContain('شاید')
    expect(card.text()).toContain('در جستجوی سالن لحاظ نمی‌شود')
    await card.get('[data-testid="concept-confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['highlights']])
  })

  it('offers alternatives (same domain first, excluding current ones) and emits add', async () => {
    const wrapper = await mountSuspended(GuideConceptList, { props: { concepts: [c({})], vocabulary: VOCAB, domain: 'hair_color' } })
    await wrapper.get('[data-testid="concept-add-open"]').trigger('click')
    const options = wrapper.findAll('[data-testid="concept-add-select"] option').map((o) => o.attributes('value'))
    expect(options).toEqual(['', 'highlights', 'almond_shape'])
    await wrapper.get('[data-testid="concept-add-select"]').setValue('highlights')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('add')).toEqual([['highlights']])
  })
})
