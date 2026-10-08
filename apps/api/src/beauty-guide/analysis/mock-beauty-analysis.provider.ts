import { BeautyAnalysisProvider, BeautyAnalysisProviderError, BeautyAnalysisRequest, BeautyAnalysisResponse } from './beauty-analysis.provider';

export const MOCK_BEAUTY_SCENARIOS = [
  'balayage', 'nails', 'low_confidence', 'unsuitable', 'medical', 'invalid', 'timeout', 'error', 'busy',
] as const;
export type MockBeautyScenario = (typeof MOCK_BEAUTY_SCENARIOS)[number];

/**
 * Deterministic provider for tests and local development -- never calls a network.
 * The scenario is process-wide: in-process e2e tests switch it via `useScenario()`
 * (app.get(BEAUTY_ANALYSIS_PROVIDER)); out-of-process runs (Playwright, local dev) pick
 * one with BEAUTY_MOCK_SCENARIO. Fixtures deliberately include a concept key the
 * vocabulary doesn't contain, to prove the validator drops invented concepts.
 */
export class MockBeautyAnalysisProvider implements BeautyAnalysisProvider {
  readonly name = 'mock';
  calls = 0;

  constructor(private scenario: MockBeautyScenario = 'balayage') {}

  useScenario(scenario: MockBeautyScenario): void {
    this.scenario = scenario;
  }

  async analyze(_request: BeautyAnalysisRequest): Promise<BeautyAnalysisResponse> {
    this.calls += 1;
    const wrap = (raw: unknown): BeautyAnalysisResponse => ({ raw, provider: this.name, model: 'mock-v1' });
    switch (this.scenario) {
      case 'timeout':
        throw new BeautyAnalysisProviderError('timeout', 'Mock provider timed out');
      case 'error':
        throw new BeautyAnalysisProviderError('provider_error', 'Mock provider failed');
      case 'busy':
        throw new BeautyAnalysisProviderError('provider_busy', 'Mock provider is overloaded');
      case 'invalid':
        return wrap({ suitable: 'yes', concepts: 'balayage' });
      case 'unsuitable':
        return wrap({ suitable: false, unsuitable_reason: 'not_beauty' });
      case 'nails':
        return wrap({
          suitable: true,
          domain: 'nails',
          safety_flag: 'none',
          look_summary_fa: 'ناخن‌های بادامی با پوشش کروم ملایم.',
          stylist_request_fa: 'ناخن‌هایم را فرم بادامی با پوشش کروم ملایم می‌خواهم.',
          concepts: [
            { key: 'almond_shape', confidence: 0.9, evidence_fa: 'نوک ناخن‌ها گرد و کشیده است.' },
            { key: 'chrome', confidence: 0.6, evidence_fa: 'سطح ناخن بازتاب آینه‌ای دارد.' },
          ],
          attributes: { nail_shape: 'almond', nail_length: 'medium', finish: 'chrome' },
          estimated_duration_minutes: { min: 60, max: 120 },
          maintenance_fa: ['معمولاً هر چند هفته یک‌بار نیاز به ترمیم دارد.'],
          discussion_points_fa: ['وضعیت فعلی ناخن‌ها'],
        });
      case 'low_confidence':
        return wrap({
          suitable: true,
          domain: 'hair_color',
          safety_flag: 'none',
          look_summary_fa: 'رنگ مو با روشن‌شدگی ملایم که جزئیات آن در تصویر واضح نیست.',
          stylist_request_fa: null,
          concepts: [{ key: 'highlights', confidence: 0.3, evidence_fa: null }],
          attributes: {},
          estimated_duration_minutes: null,
          maintenance_fa: [],
          discussion_points_fa: [],
        });
      case 'medical':
        return wrap({
          suitable: true,
          domain: 'hair_cut_style',
          safety_flag: 'medical_concern',
          look_summary_fa: 'تصویر یک مدل موی کوتاه است.',
          stylist_request_fa: null,
          concepts: [{ key: 'bob', confidence: 0.8, evidence_fa: null }],
          attributes: { hair_length: 'short' },
          estimated_duration_minutes: { min: 30, max: 60 },
          maintenance_fa: [],
          discussion_points_fa: [],
        });
      case 'balayage':
      default:
        return wrap({
          suitable: true,
          unsuitable_reason: null,
          domain: 'hair_color',
          safety_flag: 'none',
          look_summary_fa: 'این استایل ترکیبی از بالیاژ (Balayage) با روت ملت (Root Melt) و لایه‌های بلند است.',
          stylist_request_fa:
            'می‌خواهم ریشه موهایم طبیعی‌تر و تیره‌تر بماند و رنگ روشن به‌صورت تدریجی از ساقه شروع شود، بدون مرز مشخص.',
          concepts: [
            { key: 'balayage', confidence: 0.92, evidence_fa: 'روشن‌شدگی تدریجی و نامنظم روی ساقه مو.' },
            { key: 'root_melt', confidence: 0.6, evidence_fa: 'ریشه تیره‌تر با انتقال نرم.' },
            { key: 'layered_cut', confidence: 0.8, evidence_fa: 'لایه‌های بلند در اطراف صورت.' },
            { key: 'premium_ai_balayage_experience', confidence: 0.99, evidence_fa: 'invented' },
          ],
          attributes: { hair_length: 'long', hair_color_family: 'blonde', hair_texture: 'wavy', finish: 'glossy' },
          estimated_duration_minutes: { min: 180, max: 300 },
          maintenance_fa: ['ممکن است هر چند هفته یک‌بار به تونر نیاز داشته باشد.'],
          discussion_points_fa: ['سابقه دکلره قبلی', 'وضعیت فعلی سلامت مو', 'تُن رنگ دلخواه'],
        });
    }
  }
}
