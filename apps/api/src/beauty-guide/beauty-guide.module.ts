import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/user.entity';
import { AdminBeautyConceptsController } from './admin-beauty-concepts.controller';
import { BEAUTY_ANALYSIS_PROVIDER, BeautyAnalysisProvider } from './analysis/beauty-analysis.provider';
import { MOCK_BEAUTY_SCENARIOS, MockBeautyAnalysisProvider, MockBeautyScenario } from './analysis/mock-beauty-analysis.provider';
import { OpenAiCompatibleBeautyAnalysisProvider } from './analysis/openai-compatible-beauty-analysis.provider';
import { UnconfiguredBeautyAnalysisProvider } from './analysis/unconfigured-beauty-analysis.provider';
import { BeautyConcept } from './beauty-concept.entity';
import { BeautyGuideConcept } from './beauty-guide-concept.entity';
import { BeautyGuideRetentionJob } from './beauty-guide-retention.job';
import { BeautyGuideUsageService } from './beauty-guide-usage.service';
import { BeautyGuide } from './beauty-guide.entity';
import { BeautyGuidesController } from './beauty-guides.controller';
import { BeautyGuidesService } from './beauty-guides.service';
import { LocalPrivateImageStore, PRIVATE_IMAGE_STORE } from './private-image.store';
import { SalonBookingBeautyGuideController } from './salon-booking-beauty-guide.controller';

/**
 * BEAUTY_ANALYSIS_PROVIDER = mock | openai-compatible | unconfigured (default). Same
 * env-selected interface-token-factory pattern as SMS/payments/push: tests and local dev
 * never reach a real vendor unless explicitly configured, and openai-compatible fails
 * fast at boot (getOrThrow) when its credentials are missing.
 */
function beautyAnalysisProviderFactory(config: ConfigService): BeautyAnalysisProvider {
  const mode = config.get<string>('BEAUTY_ANALYSIS_PROVIDER', 'unconfigured');
  if (mode === 'mock') {
    const scenario = config.get<string>('BEAUTY_MOCK_SCENARIO', 'balayage');
    return new MockBeautyAnalysisProvider(
      (MOCK_BEAUTY_SCENARIOS as readonly string[]).includes(scenario) ? (scenario as MockBeautyScenario) : 'balayage',
    );
  }
  if (mode === 'openai-compatible') {
    return new OpenAiCompatibleBeautyAnalysisProvider({
      baseUrl: config.getOrThrow<string>('BEAUTY_AI_BASE_URL'),
      apiKey: config.getOrThrow<string>('BEAUTY_AI_API_KEY'),
      model: config.getOrThrow<string>('BEAUTY_AI_MODEL'),
      timeoutMs: Number(config.get('BEAUTY_AI_TIMEOUT_MS', 45_000)),
      maxTokens: Number(config.get('BEAUTY_AI_MAX_TOKENS', 4096)),
      responseFormat: config.get('BEAUTY_AI_RESPONSE_FORMAT', 'json_schema') === 'json_object' ? 'json_object' : 'json_schema',
    });
  }
  return new UnconfiguredBeautyAnalysisProvider();
}

@Module({
  imports: [
    TypeOrmModule.forFeature([BeautyGuide, BeautyGuideConcept, BeautyConcept, User]),
    PlatformConfigModule,
    AnalyticsModule,
    AuditModule,
    StorageModule,
    // For SalonOwnerGuard on the salon-side guide route.
    SalonsModule,
  ],
  controllers: [BeautyGuidesController, SalonBookingBeautyGuideController, AdminBeautyConceptsController],
  providers: [
    BeautyGuidesService,
    BeautyGuideUsageService,
    BeautyGuideRetentionJob,
    { provide: BEAUTY_ANALYSIS_PROVIDER, inject: [ConfigService], useFactory: beautyAnalysisProviderFactory },
    {
      provide: PRIVATE_IMAGE_STORE,
      inject: [ConfigService],
      // Deliberately OUTSIDE ./uploads (which is served publicly by useStaticAssets).
      useFactory: (config: ConfigService) =>
        new LocalPrivateImageStore(config.get<string>('PRIVATE_UPLOADS_DIR') || join(process.cwd(), 'private-uploads')),
    },
  ],
})
export class BeautyGuideModule {}
