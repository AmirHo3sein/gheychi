// Beauty Guide client helpers. Everything AI-derived is presented as a suggestion, never a
// fact: confidence is shown as words (the API never sends raw scores), durations are
// labelled as estimates, and prices only ever come from real services (service-price.ts).
import type { PricingType } from './service-price'

export type GuideStatus = 'processing' | 'ready' | 'unsuitable' | 'failed'
export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface GuideConcept {
  key: string
  nameFa: string
  nameEn: string
  domain: string
  confidence: ConfidenceLevel
  source: 'ai' | 'user'
  removed: boolean
  evidenceFa: string | null
  mappable: boolean
}

export interface BeautyGuide {
  id: string
  status: GuideStatus
  failureCode: string | null
  createdAt: string
  analyzedAt: string | null
  imagePath: string
  sourcePortfolioItemId: string | null
  domain: string | null
  lookSummaryFa: string | null
  stylistRequestFa: string | null
  durationEstimate: { min: number; max: number } | null
  attributes: Record<string, string>
  discussionPoints: string[]
  maintenance: Array<{ text: string; source: 'curated' | 'ai' }>
  safetyNote: string | null
  concepts: GuideConcept[]
  reused?: boolean
}

export interface MatchedService {
  id: string
  name: string
  pricingType: PricingType
  price: number | null
  priceMax: number | null
  discountPercent: number | null
  durationMin: number
  durationMax: number | null
  conceptKeys: string[]
  keywordMatch: boolean
  bookableOnline: boolean
}

export interface GuideMatches {
  salons: Array<{ salon: import('./types').SearchResult; services: MatchedService[]; matchedConceptKeys: string[] }>
  portfolio: Array<{
    id: string
    url: string
    caption: string | null
    serviceId: string
    serviceName: string
    salonId: string
    salonSlug: string
    salonName: string
    conceptKeys: string[]
  }>
  unmappedConceptKeys: string[]
  emptyReason: 'no_mappable_concepts' | 'gender_required' | null
}

/** Hedged wording -- "probably balayage", never "this is balayage". */
export function confidenceLabel(concept: Pick<GuideConcept, 'confidence' | 'source'>): string {
  if (concept.source === 'user') return 'انتخاب شما'
  if (concept.confidence === 'high') return 'به احتمال زیاد'
  if (concept.confidence === 'medium') return 'احتمالاً'
  return 'شاید'
}

/** «بالیاژ (Balayage)» -- the professional term, Persian first. */
export function conceptLabel(concept: Pick<GuideConcept, 'nameFa' | 'nameEn'>): string {
  return concept.nameFa === concept.nameEn ? concept.nameFa : `${concept.nameFa} (${concept.nameEn})`
}

/** Low-confidence AI guesses are suggestions only; they drive matching only once the customer adopts them. */
export function isDrivingMatch(concept: GuideConcept): boolean {
  return !concept.removed && (concept.source === 'user' || concept.confidence !== 'low')
}

export const ATTRIBUTE_LABELS: Record<string, { label: string; options: Record<string, string> }> = {
  hair_length: { label: 'بلندی مو', options: { short: 'کوتاه', medium: 'متوسط', long: 'بلند' } },
  hair_color_family: {
    label: 'رنگ مو',
    options: { black: 'مشکی', brown: 'قهوه‌ای', blonde: 'بلوند', red: 'قرمز/مسی', gray: 'دودی/نقره‌ای', fantasy: 'فانتزی' },
  },
  hair_texture: { label: 'حالت مو', options: { straight: 'صاف', wavy: 'موج‌دار', curly: 'فر' } },
  nail_shape: {
    label: 'فرم ناخن',
    options: { almond: 'بادامی', coffin: 'تابوتی', square: 'مربعی', oval: 'بیضی', stiletto: 'استیلتو', round: 'گرد' },
  },
  nail_length: { label: 'بلندی ناخن', options: { short: 'کوتاه', medium: 'متوسط', long: 'بلند' } },
  finish: { label: 'پوشش نهایی', options: { glossy: 'براق', matte: 'مات', chrome: 'کروم', natural: 'طبیعی' } },
}

/** Which attributes are worth offering for correction in a given domain. */
export function attributeKeysForDomain(domain: string | null): string[] {
  if (domain === 'nails') return ['nail_shape', 'nail_length', 'finish']
  if (domain === 'hair_color' || domain === 'hair_cut_style') return ['hair_length', 'hair_color_family', 'hair_texture']
  return []
}

/** Informational only -- never a booking duration. «حدود ۳ تا ۵ ساعت» / «حدود ۴۵ تا ۹۰ دقیقه». */
export function formatDurationEstimate(estimate: { min: number; max: number }): string {
  const fa = (n: number) => n.toLocaleString('fa-IR')
  if (estimate.min >= 120 && estimate.min % 30 === 0 && estimate.max % 30 === 0) {
    const h = (m: number) => fa(Math.round((m / 60) * 2) / 2)
    return estimate.min === estimate.max ? `حدود ${h(estimate.min)} ساعت` : `حدود ${h(estimate.min)} تا ${h(estimate.max)} ساعت`
  }
  return estimate.min === estimate.max ? `حدود ${fa(estimate.min)} دقیقه` : `حدود ${fa(estimate.min)} تا ${fa(estimate.max)} دقیقه`
}

export const UNSUITABLE_MESSAGE =
  'این تصویر برای ساخت راهنمای زیبایی مناسب نیست. لطفاً یک تصویر واضح از مدل مو، رنگ مو یا ناخن ارسال کنید.'

export function failureMessage(code: string | null): string {
  if (code === 'timeout') return 'تحلیل تصویر بیش از حد طول کشید.'
  if (code === 'provider_busy') return 'سرویس تحلیل تصویر در حال حاضر شلوغ است؛ چند لحظه بعد دوباره تلاش کنید. (از سهمیه روزانه شما کم نشد.)'
  if (code === 'provider_unreachable') return 'ارتباط با سرویس تحلیل تصویر برقرار نشد؛ کمی بعد دوباره تلاش کنید. (از سهمیه روزانه شما کم نشد.)'
  if (code === 'invalid_output' || code === 'provider_error') return 'تحلیل تصویر با خطا روبه‌رو شد.'
  if (code === 'unconfigured') return 'سرویس تحلیل تصویر در حال حاضر در دسترس نیست.'
  return 'ساخت راهنما ناموفق بود.'
}

/** Absolute URL for a private guide image (cookie-authenticated, same-site with the app). */
export function guideImageUrl(apiBase: string, imagePath: string): string {
  return `${apiBase.replace(/\/$/, '')}${imagePath}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
