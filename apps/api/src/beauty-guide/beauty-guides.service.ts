import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { AnalyticsService } from '../analytics/analytics.service';
import { MetricsService } from '../metrics/metrics.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { User } from '../users/user.entity';
import {
  ATTRIBUTE_ENUMS, AttributeKey, BEAUTY_PROMPT_VERSION, BEAUTY_SCHEMA_VERSION, BeautyAttributes,
  beautyAnalysisJsonSchema, buildBeautySystemPrompt, InvalidBeautyAnalysisError, parseBeautyAnalysis,
  VocabularyEntry,
} from './analysis/beauty-analysis.contract';
import {
  BEAUTY_ANALYSIS_PROVIDER, BeautyAnalysisErrorCode, BeautyAnalysisProvider, BeautyAnalysisProviderError,
} from './analysis/beauty-analysis.provider';
import { BeautyConcept } from './beauty-concept.entity';
import { BeautyGuideConcept } from './beauty-guide-concept.entity';
import { CandidateServiceRow, MatchedSalon, rankMatches } from './beauty-guide-matching';
import { BeautyGuideUsageService } from './beauty-guide-usage.service';
import { BeautyGuide, BeautyGuideFailureCode } from './beauty-guide.entity';
import { BeautyGuideMatchesQueryDto, UpdateBeautyGuideDto } from './dto/beauty-guide.dto';
import { processInspirationImage } from './image-processing';
import { PRIVATE_IMAGE_STORE, PrivateImageStore } from './private-image.store';

export interface BeautyGuideConceptView {
  key: string;
  nameFa: string;
  nameEn: string;
  domain: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'ai' | 'user';
  removed: boolean;
  evidenceFa: string | null;
  /** False = informational only (no service category mapped yet). */
  mappable: boolean;
}

export interface BeautyGuideView {
  id: string;
  status: BeautyGuide['status'];
  failureCode: BeautyGuideFailureCode | null;
  createdAt: Date;
  analyzedAt: Date | null;
  /** Path relative to the API base; served only to authorized callers. */
  imagePath: string;
  sourcePortfolioItemId: string | null;
  domain: string | null;
  lookSummaryFa: string | null;
  stylistRequestFa: string | null;
  durationEstimate: { min: number; max: number } | null;
  attributes: BeautyAttributes;
  discussionPoints: string[];
  maintenance: Array<{ text: string; source: 'curated' | 'ai' }>;
  safetyNote: string | null;
  concepts: BeautyGuideConceptView[];
  /** True when this response returned an earlier guide for the same image instead of re-analyzing. */
  reused?: boolean;
}

export interface BeautyGuideMatches {
  salons: MatchedSalon[];
  portfolio: Array<{
    id: string;
    url: string;
    caption: string | null;
    serviceId: string;
    serviceName: string;
    salonId: string;
    salonSlug: string;
    salonName: string;
    conceptKeys: string[];
  }>;
  /** Effective concepts that have no service category yet (shown, never matched). */
  unmappedConceptKeys: string[];
  /** Set when matching couldn't run at all, so the UI can explain why instead of showing a bare empty list. */
  emptyReason: 'no_mappable_concepts' | 'gender_required' | null;
}

const MAX_CONCEPTS_PER_GUIDE = 12;
const NO_QUOTA_FAILURES = new Set<BeautyAnalysisErrorCode>(['unconfigured', 'provider_busy', 'provider_unreachable']);
const CANDIDATE_ROW_CAP = 500;
const PORTFOLIO_CAP = 24;
const DEFAULT_RADIUS_KM = 15;

/**
 * Beauty Guide's application service. The one hard rule this class exists to uphold: AI
 * output only ever fills this guide's own advisory columns. Matching, prices, durations
 * and booking all come from the real catalog (salon_services) and the existing booking
 * flow; nothing here writes to services, salons, bookings, payments or wallets.
 */
@Injectable()
export class BeautyGuidesService {
  private readonly logger = new Logger(BeautyGuidesService.name);

  constructor(
    @InjectRepository(BeautyGuide) private readonly guides: Repository<BeautyGuide>,
    @InjectRepository(BeautyGuideConcept) private readonly guideConcepts: Repository<BeautyGuideConcept>,
    @InjectRepository(BeautyConcept) private readonly concepts: Repository<BeautyConcept>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BEAUTY_ANALYSIS_PROVIDER) private readonly provider: BeautyAnalysisProvider,
    @Inject(PRIVATE_IMAGE_STORE) private readonly privateStore: PrivateImageStore,
    @Inject(STORAGE_PROVIDER) private readonly publicStorage: StorageProvider,
    private readonly usage: BeautyGuideUsageService,
    private readonly config: PlatformConfigService,
    private readonly analytics: AnalyticsService,
    private readonly metrics: MetricsService,
  ) {}

  // --- Feature flag ---------------------------------------------------------------

  /** Flag off ⇒ the customer surface behaves as if it doesn't exist (404), never a 500. */
  async assertEnabled(): Promise<void> {
    const { beautyGuideEnabled } = await this.config.getFeatureFlags();
    if (!beautyGuideEnabled) throw new NotFoundException();
  }

  // --- Creation & analysis -----------------------------------------------------------

  async createFromUpload(userId: string, upload: Buffer): Promise<BeautyGuideView> {
    await this.assertEnabled();
    const processed = await processInspirationImage(upload);
    return this.createFromProcessed(userId, processed.jpeg, processed.sha256, null);
  }

  /**
   * "Explain this look": start a guide from a salon's PUBLISHED portfolio image. The bytes
   * are copied server-side into the private store (the guide never points at the public
   * file), then run through exactly the same pipeline as an upload -- one analysis engine.
   */
  async createFromPortfolio(userId: string, portfolioItemId: string): Promise<BeautyGuideView> {
    await this.assertEnabled();
    const { portfolioEnabled } = await this.config.getFeatureFlags();
    if (!portfolioEnabled) throw new NotFoundException();
    const [item]: Array<{ storage_key: string }> = await this.dataSource.query(
      `SELECT pi.storage_key FROM portfolio_items pi JOIN salons s ON s.id = pi.salon_id
        WHERE pi.id = $1 AND pi.status = 'published' AND s.status = 'approved'`,
      [portfolioItemId],
    );
    if (!item) throw new NotFoundException();
    let bytes: Buffer;
    try {
      bytes = await this.publicStorage.read(item.storage_key);
    } catch {
      throw new NotFoundException();
    }
    const processed = await processInspirationImage(bytes);
    return this.createFromProcessed(userId, processed.jpeg, processed.sha256, portfolioItemId);
  }

  private async createFromProcessed(
    userId: string,
    jpeg: Buffer,
    sha256: string,
    sourcePortfolioItemId: string | null,
  ): Promise<BeautyGuideView> {
    // Per-user duplicate cache: the same person re-uploading the same image under the same
    // prompt/schema version gets their earlier guide back -- no AI call, no quota. Never
    // shared across users: a guide (and the image behind it) is private to its author.
    const existing = await this.guides.findOne({
      where: {
        userId,
        imageSha256: sha256,
        promptVersion: BEAUTY_PROMPT_VERSION,
        schemaVersion: BEAUTY_SCHEMA_VERSION,
        status: In(['ready', 'unsuitable']),
      },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      void this.analytics.track('beauty_guide_reused', { beautyGuideId: existing.id }, { userId }).catch(() => {});
      return { ...(await this.toView(existing)), reused: true };
    }

    return this.usage.withUserLock(userId, async () => {
      await this.usage.assertWithinLimits(userId);
      const imageKey = `beauty-guides/${userId}/${randomUUID()}.jpg`;
      await this.privateStore.put(imageKey, jpeg);
      const guide = await this.guides.save(
        this.guides.create({ userId, imageKey, imageSha256: sha256, sourcePortfolioItemId, status: 'processing' }),
      );
      void this.analytics
        .track('beauty_guide_created', { beautyGuideId: guide.id, fromPortfolio: sourcePortfolioItemId !== null }, { userId })
        .catch(() => {});
      await this.analyze(guide, jpeg);
      return this.toView((await this.guides.findOneBy({ id: guide.id }))!);
    });
  }

  async retry(userId: string, guideId: string): Promise<BeautyGuideView> {
    await this.assertEnabled();
    const guide = await this.findOwned(userId, guideId);
    if (guide.status !== 'failed') throw new ConflictException('این راهنما نیازی به تلاش دوباره ندارد');
    const jpeg = await this.privateStore.get(guide.imageKey);
    if (!jpeg) throw new NotFoundException();
    return this.usage.withUserLock(userId, async () => {
      await this.usage.assertWithinLimits(userId);
      await this.guides.update({ id: guide.id }, { status: 'processing', failureCode: null });
      await this.analyze({ ...guide, status: 'processing' }, jpeg);
      return this.toView((await this.guides.findOneBy({ id: guide.id }))!);
    });
  }

  /**
   * Calls the provider, validates the result, and records exactly one terminal state.
   * Synchronous by design (no queue exists in this codebase; the provider call is bounded
   * by its own timeout far inside the HTTP request timeout). The row is already persisted
   * as `processing`, so a dropped connection leaves a recoverable record, and
   * BeautyGuideRetentionJob fails any row stuck in `processing`.
   */
  private async analyze(guide: BeautyGuide, jpeg: Buffer): Promise<void> {
    const vocabulary = await this.activeVocabulary();
    const startedAt = Date.now();
    void this.analytics
      .track('beauty_guide_analysis_started', { beautyGuideId: guide.id, provider: this.provider.name }, { userId: guide.userId })
      .catch(() => {});

    let response;
    try {
      response = await this.provider.analyze({
        imageJpeg: jpeg,
        vocabulary,
        systemPrompt: buildBeautySystemPrompt(vocabulary),
        jsonSchema: beautyAnalysisJsonSchema(vocabulary),
      });
    } catch (err) {
      const code: BeautyAnalysisErrorCode = err instanceof BeautyAnalysisProviderError ? err.code : 'provider_error';
      if (!(err instanceof BeautyAnalysisProviderError)) {
        this.logger.error(`Unexpected beauty analysis failure for guide ${guide.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Only a request the provider actually processed costs quota: an unconfigured provider,
      // an unreachable endpoint, or a 429/503 "busy" rejection did no work for us.
      const providerDidWork = !NO_QUOTA_FAILURES.has(code);
      await this.recordFailure(guide, code, providerDidWork, startedAt, null);
      return;
    }

    let parsed;
    try {
      parsed = parseBeautyAnalysis(response.raw, vocabulary);
    } catch (err) {
      if (!(err instanceof InvalidBeautyAnalysisError)) throw err;
      this.logger.warn(`Beauty analysis for guide ${guide.id} failed validation: ${err.message}`);
      await this.recordFailure(guide, 'invalid_output', true, startedAt, response);
      return;
    }

    const versions = {
      provider: response.provider,
      model: response.model,
      promptVersion: BEAUTY_PROMPT_VERSION,
      schemaVersion: BEAUTY_SCHEMA_VERSION,
      providerCalled: true,
      analyzedAt: new Date(),
    };
    const seconds = (Date.now() - startedAt) / 1000;

    if (parsed.kind === 'unsuitable') {
      await this.guides.update(
        { id: guide.id, status: 'processing' },
        { ...versions, status: 'unsuitable', failureCode: 'unsuitable', rawAnalysis: parsed },
      );
      this.metrics.observeBeautyGuideAnalysis(response.provider, 'unsuitable', seconds);
      void this.analytics
        .track('beauty_guide_analysis_completed', { beautyGuideId: guide.id, outcome: 'unsuitable', reason: parsed.reason }, { userId: guide.userId })
        .catch(() => {});
      return;
    }

    const conceptIdByKey = new Map(
      (await this.concepts.find({ where: { key: In(parsed.concepts.map((c) => c.key)) } })).map((c) => [c.key, c.id]),
    );
    await this.dataSource.transaction(async (em) => {
      const updated = await em.update(
        BeautyGuide,
        { id: guide.id, status: 'processing' },
        {
          ...versions,
          status: 'ready',
          failureCode: null,
          domain: parsed.domain,
          lookSummaryFa: parsed.lookSummaryFa,
          stylistRequestFa: parsed.stylistRequestFa,
          durationMinEstimate: parsed.durationMinutes?.min ?? null,
          durationMaxEstimate: parsed.durationMinutes?.max ?? null,
          attributes: parsed.attributes,
          discussionPoints: parsed.discussionPointsFa,
          maintenanceAi: parsed.maintenanceFa,
          safetyNote: parsed.safetyFlag === 'medical_concern' ? 'medical_concern' : null,
          rawAnalysis: parsed,
        },
      );
      // Lost a race (e.g. the stale-processing sweeper already failed it) -- leave it be.
      if (!updated.affected) return;
      await em.delete(BeautyGuideConcept, { guideId: guide.id, source: 'ai' });
      const rows = parsed.concepts
        .filter((c) => conceptIdByKey.has(c.key))
        .map((c, i) =>
          em.create(BeautyGuideConcept, {
            guideId: guide.id,
            conceptId: conceptIdByKey.get(c.key)!,
            confidence: c.confidence,
            source: 'ai',
            removed: false,
            evidenceFa: c.evidenceFa,
            sortOrder: i,
          }),
        );
      if (rows.length) await em.save(rows);
    });
    this.metrics.observeBeautyGuideAnalysis(response.provider, 'ready', seconds);
    void this.analytics
      .track(
        'beauty_guide_analysis_completed',
        { beautyGuideId: guide.id, outcome: 'ready', domain: parsed.domain, conceptCount: parsed.concepts.length, durationMs: Math.round(seconds * 1000) },
        { userId: guide.userId },
      )
      .catch(() => {});
  }

  private async recordFailure(
    guide: BeautyGuide,
    code: BeautyGuideFailureCode,
    providerCalled: boolean,
    startedAt: number,
    response: { provider: string; model: string } | null,
  ): Promise<void> {
    await this.guides.update(
      { id: guide.id, status: 'processing' },
      {
        status: 'failed',
        failureCode: code,
        providerCalled,
        analyzedAt: providerCalled ? new Date() : null,
        provider: response?.provider ?? this.provider.name,
        model: response?.model ?? null,
        promptVersion: BEAUTY_PROMPT_VERSION,
        schemaVersion: BEAUTY_SCHEMA_VERSION,
      },
    );
    this.metrics.observeBeautyGuideAnalysis(this.provider.name, code, (Date.now() - startedAt) / 1000);
    void this.analytics
      .track('beauty_guide_analysis_failed', { beautyGuideId: guide.id, failureCode: code }, { userId: guide.userId })
      .catch(() => {});
  }

  // --- Reads ---------------------------------------------------------------------------

  async listActiveConcepts(): Promise<Array<{ key: string; nameFa: string; nameEn: string; domain: string }>> {
    await this.assertEnabled();
    const rows = await this.concepts.find({ where: { isActive: true }, order: { domain: 'ASC', sortOrder: 'ASC' } });
    return rows.map((c) => ({ key: c.key, nameFa: c.nameFa, nameEn: c.nameEn, domain: c.domain }));
  }

  async list(userId: string): Promise<BeautyGuideView[]> {
    await this.assertEnabled();
    const guides = await this.guides.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 50 });
    return Promise.all(guides.map((g) => this.toView(g)));
  }

  async get(userId: string, guideId: string): Promise<BeautyGuideView> {
    await this.assertEnabled();
    return this.toView(await this.findOwned(userId, guideId));
  }

  async getImage(userId: string, guideId: string): Promise<Buffer> {
    await this.assertEnabled();
    const guide = await this.findOwned(userId, guideId);
    const bytes = await this.privateStore.get(guide.imageKey);
    if (!bytes) throw new NotFoundException();
    return bytes;
  }

  // --- Corrections & deletion -------------------------------------------------------

  async update(userId: string, guideId: string, dto: UpdateBeautyGuideDto): Promise<BeautyGuideView> {
    await this.assertEnabled();
    const guide = await this.findOwned(userId, guideId);
    if (guide.status !== 'ready') throw new ConflictException('فقط راهنمای آماده قابل ویرایش است');

    const attributes = dto.attributes ? this.applyAttributeEdits(guide.attributes, dto.attributes) : null;
    const touchedKeys = [...(dto.removeConceptKeys ?? []), ...(dto.restoreConceptKeys ?? []), ...(dto.addConceptKeys ?? [])];
    const conceptsByKey = new Map(
      (touchedKeys.length ? await this.concepts.find({ where: { key: In(touchedKeys) } }) : []).map((c) => [c.key, c]),
    );

    await this.dataSource.transaction(async (em) => {
      for (const key of dto.removeConceptKeys ?? []) {
        const concept = conceptsByKey.get(key);
        if (concept) await em.update(BeautyGuideConcept, { guideId, conceptId: concept.id }, { removed: true });
      }
      for (const key of dto.restoreConceptKeys ?? []) {
        const concept = conceptsByKey.get(key);
        if (concept) await em.update(BeautyGuideConcept, { guideId, conceptId: concept.id }, { removed: false });
      }
      for (const key of dto.addConceptKeys ?? []) {
        const concept = conceptsByKey.get(key);
        if (!concept || !concept.isActive) throw new BadRequestException('مفهوم انتخاب‌شده معتبر نیست');
        // Adding a concept the AI also found counts as the customer CONFIRMING it: it
        // becomes high-confidence and user-owned, so a low AI guess the customer agrees with
        // now drives matching.
        await em.upsert(
          BeautyGuideConcept,
          { guideId, conceptId: concept.id, confidence: 'high', source: 'user', removed: false, sortOrder: 100 },
          ['guideId', 'conceptId'],
        );
      }
      const active = await em.count(BeautyGuideConcept, { where: { guideId, removed: false } });
      if (active > MAX_CONCEPTS_PER_GUIDE) throw new BadRequestException('تعداد مفاهیم بیش از حد مجاز است');
      if (attributes) await em.update(BeautyGuide, { id: guideId }, { attributes });
      await em.update(BeautyGuide, { id: guideId }, { updatedAt: new Date() });
    });

    void this.analytics
      .track(
        'beauty_guide_updated',
        {
          beautyGuideId: guideId,
          removed: dto.removeConceptKeys?.length ?? 0,
          added: dto.addConceptKeys?.length ?? 0,
          attributesChanged: dto.attributes ? Object.keys(dto.attributes).length : 0,
        },
        { userId },
      )
      .catch(() => {});
    return this.toView((await this.guides.findOneBy({ id: guideId }))!);
  }

  private applyAttributeEdits(current: BeautyAttributes, edits: Record<string, string | null>): BeautyAttributes {
    const next: Record<string, string> = { ...(current as Record<string, string>) };
    for (const [key, value] of Object.entries(edits)) {
      if (!(key in ATTRIBUTE_ENUMS)) throw new BadRequestException('ویژگی نامعتبر است');
      if (value === null) {
        delete next[key];
        continue;
      }
      if (!(ATTRIBUTE_ENUMS[key as AttributeKey] as readonly string[]).includes(value)) {
        throw new BadRequestException('مقدار ویژگی نامعتبر است');
      }
      next[key] = value;
    }
    return next as BeautyAttributes;
  }

  /**
   * Hard delete: the row goes (bookings keep existing, their beauty_guide_id nulled by the
   * FK) and the private image is removed. The image delete is best-effort -- the row is
   * the source of truth -- but every failure is logged with the orphaned key.
   */
  async remove(userId: string, guideId: string): Promise<void> {
    await this.assertEnabled();
    const guide = await this.findOwned(userId, guideId);
    await this.guides.delete({ id: guide.id, userId });
    await this.privateStore.delete(guide.imageKey).catch((err) => {
      this.logger.error(`Failed to delete private image ${guide.imageKey} for deleted guide ${guide.id}: ${err instanceof Error ? err.message : String(err)}`);
    });
    void this.analytics.track('beauty_guide_deleted', { beautyGuideId: guide.id }, { userId }).catch(() => {});
  }

  // --- Provider (salon) access -------------------------------------------------------

  /**
   * A salon sees a customer's guide ONLY through a booking at that salon that carries it
   * -- the customer attached it when booking. Not gated by the feature flag: a guide
   * already attached to a booking stays readable as booking history even if the feature is
   * later switched off.
   */
  async getForSalonBooking(salonId: string, bookingId: string): Promise<{ guide: BeautyGuideView; imagePath: string }> {
    const guide = await this.findForSalonBooking(salonId, bookingId);
    const view = await this.toView(guide);
    const imagePath = `/salons/mine/bookings/${bookingId}/beauty-guide/image`;
    return { guide: { ...view, imagePath, failureCode: null }, imagePath };
  }

  async getImageForSalonBooking(salonId: string, bookingId: string): Promise<Buffer> {
    const guide = await this.findForSalonBooking(salonId, bookingId);
    const bytes = await this.privateStore.get(guide.imageKey);
    if (!bytes) throw new NotFoundException();
    return bytes;
  }

  private async findForSalonBooking(salonId: string, bookingId: string): Promise<BeautyGuide> {
    const [row]: Array<{ beauty_guide_id: string | null }> = await this.dataSource.query(
      `SELECT beauty_guide_id FROM bookings WHERE id = $1 AND salon_id = $2`,
      [bookingId, salonId],
    );
    if (!row?.beauty_guide_id) throw new NotFoundException();
    const guide = await this.guides.findOneBy({ id: row.beauty_guide_id });
    if (!guide) throw new NotFoundException();
    return guide;
  }

  // --- Matching ------------------------------------------------------------------------

  async matches(userId: string, guideId: string, query: BeautyGuideMatchesQueryDto): Promise<BeautyGuideMatches> {
    await this.assertEnabled();
    const guide = await this.findOwned(userId, guideId);
    if (guide.status !== 'ready') throw new ConflictException('این راهنما هنوز آماده نیست');

    const effective = await this.effectiveConcepts(guide.id);
    const mappable = effective.filter((c) => c.categoryId !== null);
    const unmappedConceptKeys = effective.filter((c) => c.categoryId === null).map((c) => c.key);
    const empty = (emptyReason: BeautyGuideMatches['emptyReason']): BeautyGuideMatches => ({
      salons: [], portfolio: [], unmappedConceptKeys, emptyReason,
    });
    if (mappable.length === 0) return empty('no_mappable_concepts');

    // Gender comes from the SESSION user, never from the client -- the same unconditional
    // gender rule every public listing enforces, applied server-side here.
    const user = await this.users.findOneBy({ id: userId });
    const genderTarget = user?.gender === 'female' ? 'women' : user?.gender === 'male' ? 'men' : null;
    if (!genderTarget) return empty('gender_required');

    const categoryIds = [...new Set(mappable.map((c) => c.categoryId!))];
    const radiusMeters = (query.radiusKm ?? DEFAULT_RADIUS_KM) * 1000;
    const { reviewsEnabled, storiesEnabled, portfolioEnabled } = await this.config.getFeatureFlags();

    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `
      SELECT s.id AS salon_id, s.name AS salon_name, s.slug, s.city, s.address, s.rating_avg, s.rating_count,
             ST_Distance(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km,
             (SELECT sp.url FROM salon_photos sp WHERE sp.salon_id = s.id ORDER BY sp.is_cover DESC, sp.sort_order ASC LIMIT 1) AS cover_photo,
             EXISTS (SELECT 1 FROM salon_stories st WHERE st.salon_id = s.id AND st.status = 'published' AND st.expires_at > now()) AS has_active_story,
             ss.id AS service_id, ss.name AS service_name, ss.description AS service_description, ss.category_id,
             ss.pricing_type, ss.price, ss.price_max, ss.discount_percent, ss.duration_min, ss.duration_max,
             EXISTS (SELECT 1 FROM portfolio_items pi WHERE pi.service_id = ss.id AND pi.status = 'published') AS has_portfolio
        FROM salon_services ss
        JOIN salons s ON s.id = ss.salon_id
       WHERE ss.is_active
         AND ss.category_id = ANY($3::int[])
         AND s.status = 'approved'
         AND s.gender_target = $4
         AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5)
       ORDER BY distance_km ASC
       LIMIT ${CANDIDATE_ROW_CAP}
      `,
      [query.lng, query.lat, categoryIds, genderTarget, radiusMeters],
    );
    const candidates: CandidateServiceRow[] = rows.map((r) => ({
      salonId: r.salon_id as string,
      salonName: r.salon_name as string,
      slug: r.slug as string,
      city: r.city as string,
      address: r.address as string,
      ratingAvg: Number(r.rating_avg),
      ratingCount: Number(r.rating_count),
      distanceKm: Number(r.distance_km),
      coverPhoto: (r.cover_photo as string) ?? null,
      hasActiveStory: storiesEnabled ? Boolean(r.has_active_story) : false,
      serviceId: r.service_id as string,
      serviceName: r.service_name as string,
      serviceDescription: (r.service_description as string) ?? null,
      categoryId: Number(r.category_id),
      pricingType: r.pricing_type as CandidateServiceRow['pricingType'],
      price: r.price === null ? null : Number(r.price),
      priceMax: r.price_max === null ? null : Number(r.price_max),
      discountPercent: r.discount_percent === null ? null : Number(r.discount_percent),
      durationMin: Number(r.duration_min),
      durationMax: r.duration_max === null ? null : Number(r.duration_max),
      hasPortfolio: portfolioEnabled && Boolean(r.has_portfolio),
    }));
    const salons = rankMatches(candidates, mappable, reviewsEnabled);

    const portfolio = portfolioEnabled ? await this.matchPortfolio(mappable, categoryIds, genderTarget, query, radiusMeters) : [];

    void this.analytics
      .track('beauty_guide_matches_viewed', { beautyGuideId: guide.id, salonCount: salons.length, portfolioCount: portfolio.length }, { userId })
      .catch(() => {});
    return { salons, portfolio, unmappedConceptKeys, emptyReason: null };
  }

  private async matchPortfolio(
    concepts: BeautyConcept[],
    categoryIds: number[],
    genderTarget: string,
    query: BeautyGuideMatchesQueryDto,
    radiusMeters: number,
  ): Promise<BeautyGuideMatches['portfolio']> {
    const rows: Array<Record<string, unknown>> = await this.dataSource.query(
      `
      SELECT pi.id, pi.url, pi.caption, pi.service_id, ss.name AS service_name, ss.category_id,
             s.id AS salon_id, s.slug AS salon_slug, s.name AS salon_name
        FROM portfolio_items pi
        JOIN salon_services ss ON ss.id = pi.service_id
        JOIN salons s ON s.id = pi.salon_id
       WHERE pi.status = 'published'
         AND ss.is_active
         AND ss.category_id = ANY($1::int[])
         AND s.status = 'approved'
         AND s.gender_target = $2
         AND ST_DWithin(s.location, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
       ORDER BY pi.created_at DESC
       LIMIT 120
      `,
      [categoryIds, genderTarget, query.lng, query.lat, radiusMeters],
    );
    return rows
      .map((r) => {
        const related = concepts.filter((c) => c.categoryId === Number(r.category_id));
        const text = `${r.caption ?? ''} ${r.service_name}`.toLowerCase();
        const named = related.filter((c) => c.keywords.some((k) => k && text.includes(k.toLowerCase())));
        return {
          score: named.length,
          item: {
            id: r.id as string,
            url: r.url as string,
            caption: (r.caption as string) ?? null,
            serviceId: r.service_id as string,
            serviceName: r.service_name as string,
            salonId: r.salon_id as string,
            salonSlug: r.salon_slug as string,
            salonName: r.salon_name as string,
            conceptKeys: (named.length ? named : related).map((c) => c.key),
          },
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, PORTFOLIO_CAP)
      .map((x) => x.item);
  }

  /**
   * The concepts that drive matching: not removed by the customer, and either confident
   * enough (high/medium) or explicitly confirmed by the customer. A low-confidence AI guess
   * is shown as a suggestion but never matched on unless the customer adopts it.
   */
  private async effectiveConcepts(guideId: string): Promise<BeautyConcept[]> {
    const rows = await this.guideConcepts.find({ where: { guideId, removed: false } });
    const usable = rows.filter((r) => r.source === 'user' || r.confidence !== 'low');
    if (!usable.length) return [];
    return this.concepts.find({ where: { id: In(usable.map((r) => r.conceptId)), isActive: true } });
  }

  // --- Helpers ---------------------------------------------------------------------------

  private async findOwned(userId: string, guideId: string): Promise<BeautyGuide> {
    // 404 (not 403) for someone else's guide: never confirm that a guide id exists.
    const guide = await this.guides.findOneBy({ id: guideId, userId });
    if (!guide) throw new NotFoundException();
    return guide;
  }

  private async activeVocabulary(): Promise<VocabularyEntry[]> {
    const rows = await this.concepts.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } });
    return rows.map((c) => ({ key: c.key, nameEn: c.nameEn, nameFa: c.nameFa, domain: c.domain }));
  }

  private async toView(guide: BeautyGuide): Promise<BeautyGuideView> {
    const rows = await this.guideConcepts.find({ where: { guideId: guide.id }, order: { sortOrder: 'ASC' } });
    const conceptById = new Map(
      (rows.length ? await this.concepts.find({ where: { id: In(rows.map((r) => r.conceptId)) } }) : []).map((c) => [c.id, c]),
    );
    const concepts: BeautyGuideConceptView[] = rows
      .filter((r) => conceptById.has(r.conceptId))
      .map((r) => {
        const c = conceptById.get(r.conceptId)!;
        return {
          key: c.key,
          nameFa: c.nameFa,
          nameEn: c.nameEn,
          domain: c.domain,
          confidence: r.confidence,
          source: r.source,
          removed: r.removed,
          evidenceFa: r.evidenceFa,
          mappable: c.categoryId !== null && c.isActive,
        };
      });
    // Curated concept copy comes first; AI maintenance text is secondary and always hedged.
    const curated = rows
      .filter((r) => !r.removed)
      .map((r) => conceptById.get(r.conceptId)?.maintenanceFa)
      .filter((t): t is string => Boolean(t));
    const maintenance = [
      ...[...new Set(curated)].map((text) => ({ text, source: 'curated' as const })),
      ...(guide.maintenanceAi ?? []).map((text) => ({ text, source: 'ai' as const })),
    ];
    return {
      id: guide.id,
      status: guide.status,
      failureCode: guide.failureCode,
      createdAt: guide.createdAt,
      analyzedAt: guide.analyzedAt,
      imagePath: `/beauty-guides/${guide.id}/image`,
      sourcePortfolioItemId: guide.sourcePortfolioItemId,
      domain: guide.domain,
      lookSummaryFa: guide.lookSummaryFa,
      stylistRequestFa: guide.stylistRequestFa,
      durationEstimate:
        guide.durationMinEstimate !== null && guide.durationMaxEstimate !== null
          ? { min: guide.durationMinEstimate, max: guide.durationMaxEstimate }
          : null,
      attributes: guide.attributes ?? {},
      discussionPoints: guide.discussionPoints ?? [],
      maintenance,
      safetyNote: guide.safetyNote,
      concepts,
    };
  }
}
