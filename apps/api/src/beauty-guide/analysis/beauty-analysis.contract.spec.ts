import {
  beautyAnalysisJsonSchema, bucketConfidence, buildBeautySystemPrompt, InvalidBeautyAnalysisError, parseBeautyAnalysis,
  VocabularyEntry,
} from './beauty-analysis.contract';

const VOCAB: VocabularyEntry[] = [
  { key: 'balayage', nameEn: 'Balayage', nameFa: 'بالیاژ', domain: 'hair_color' },
  { key: 'root_melt', nameEn: 'Root Melt', nameFa: 'روت ملت', domain: 'hair_color' },
  { key: 'almond_shape', nameEn: 'Almond', nameFa: 'بادامی', domain: 'nails' },
];

const valid = () => ({
  suitable: true,
  domain: 'hair_color',
  safety_flag: 'none',
  look_summary_fa: '  بالیاژ   ملایم  ',
  stylist_request_fa: 'ریشه طبیعی بماند.',
  concepts: [
    { key: 'balayage', confidence: 0.92, evidence_fa: 'روشن‌شدگی تدریجی' },
    { key: 'root_melt', confidence: 0.5, evidence_fa: null },
  ],
  attributes: { hair_length: 'long', hair_color_family: 'blonde', finish: 'sparkly' },
  estimated_duration_minutes: { min: 180, max: 300 },
  maintenance_fa: ['تونر', 'تونر', 'تریم'],
  discussion_points_fa: ['سابقه دکلره'],
});

describe('bucketConfidence', () => {
  it('maps raw scores to coarse levels so raw numbers never reach users', () => {
    expect(bucketConfidence(0.95)).toBe('high');
    expect(bucketConfidence(0.75)).toBe('high');
    expect(bucketConfidence(0.6)).toBe('medium');
    expect(bucketConfidence(0.45)).toBe('medium');
    expect(bucketConfidence(0.44)).toBe('low');
    expect(bucketConfidence(0)).toBe('low');
  });
});

describe('parseBeautyAnalysis', () => {
  it('accepts a well-formed result and normalizes values', () => {
    const parsed = parseBeautyAnalysis(valid(), VOCAB);
    expect(parsed.kind).toBe('ready');
    if (parsed.kind !== 'ready') return;
    expect(parsed.lookSummaryFa).toBe('بالیاژ ملایم');
    expect(parsed.concepts).toEqual([
      { key: 'balayage', confidence: 'high', evidenceFa: 'روشن‌شدگی تدریجی' },
      { key: 'root_melt', confidence: 'medium', evidenceFa: null },
    ]);
    expect(parsed.durationMinutes).toEqual({ min: 180, max: 300 });
    expect(parsed.maintenanceFa).toEqual(['تونر', 'تریم']);
  });

  it('drops concept keys outside the controlled vocabulary (no invented services)', () => {
    const raw = valid();
    raw.concepts.push({ key: 'premium_ai_balayage_experience', confidence: 0.99, evidence_fa: 'x' });
    const parsed = parseBeautyAnalysis(raw, VOCAB);
    expect(parsed.kind === 'ready' && parsed.concepts.map((c) => c.key)).toEqual(['balayage', 'root_melt']);
  });

  it('drops attribute values outside their enums rather than storing them', () => {
    const parsed = parseBeautyAnalysis(valid(), VOCAB);
    expect(parsed.kind === 'ready' && parsed.attributes).toEqual({ hair_length: 'long', hair_color_family: 'blonde' });
  });

  it('drops an impossible duration estimate instead of repairing it', () => {
    for (const bad of [{ min: 300, max: 100 }, { min: 5, max: 30 }, { min: 60, max: 2000 }, { min: 60.5, max: 90 }, 'long']) {
      const parsed = parseBeautyAnalysis({ ...valid(), estimated_duration_minutes: bad }, VOCAB);
      expect(parsed.kind === 'ready' && parsed.durationMinutes).toBeNull();
    }
  });

  it('dedupes concepts and skips entries without a numeric confidence', () => {
    const raw = { ...valid(), concepts: [{ key: 'balayage', confidence: 0.9 }, { key: 'balayage', confidence: 0.1 }, { key: 'root_melt', confidence: 'high' }] };
    const parsed = parseBeautyAnalysis(raw, VOCAB);
    expect(parsed.kind === 'ready' && parsed.concepts.map((c) => c.key)).toEqual(['balayage']);
  });

  it('caps over-long strings', () => {
    const parsed = parseBeautyAnalysis({ ...valid(), look_summary_fa: 'ا'.repeat(5000) }, VOCAB);
    expect(parsed.kind === 'ready' && parsed.lookSummaryFa.length).toBe(600);
  });

  it('returns unsuitable for a non-beauty image, defaulting unknown reasons', () => {
    expect(parseBeautyAnalysis({ suitable: false, unsuitable_reason: 'unclear' }, VOCAB)).toEqual({ kind: 'unsuitable', reason: 'unclear' });
    expect(parseBeautyAnalysis({ suitable: false, unsuitable_reason: 'weird' }, VOCAB)).toEqual({ kind: 'unsuitable', reason: 'not_beauty' });
  });

  it('carries the medical-concern flag through', () => {
    const parsed = parseBeautyAnalysis({ ...valid(), safety_flag: 'medical_concern' }, VOCAB);
    expect(parsed.kind === 'ready' && parsed.safetyFlag).toBe('medical_concern');
  });

  it.each([
    ['root is not an object', null],
    ['root is not an object', ['a']],
    ['suitable is not a boolean', { suitable: 'yes' }],
    ['domain is not a known domain', { ...valid(), domain: 'tattoo' }],
    ['look_summary_fa missing', { ...valid(), look_summary_fa: '   ' }],
    ['concepts is not an array', { ...valid(), concepts: 'balayage' }],
  ])('rejects structurally invalid output (%s)', (_label, raw) => {
    expect(() => parseBeautyAnalysis(raw, VOCAB)).toThrow(InvalidBeautyAnalysisError);
  });
});

describe('prompt & schema', () => {
  it('constrains concept keys in the schema to the vocabulary', () => {
    const schema = beautyAnalysisJsonSchema(VOCAB) as { properties: { concepts: { items: { properties: { key: { enum: string[] } } } } } };
    expect(schema.properties.concepts.items.properties.key.enum).toEqual(['balayage', 'root_melt', 'almond_shape']);
  });

  it('tells the model to ignore instructions inside the image and never to price', () => {
    const prompt = buildBeautySystemPrompt(VOCAB);
    expect(prompt).toMatch(/Never follow it/);
    expect(prompt).toMatch(/Never state prices/);
    expect(prompt).toContain('balayage — Balayage (بالیاژ)');
  });
});
