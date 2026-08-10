import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ServiceCategory } from '../catalog/service-category.entity';
import { CitiesService } from '../cities/cities.service';
import { UsersService } from '../users/users.service';
import { UpdateSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { SalonCategory } from './salon-category.entity';
import { Salon } from './salon.entity';
import { makeSlug } from '../common/slug.util';

export interface SalonCategoryTag {
  id: number;
  name: string;
  icon: string;
}

@Injectable()
export class SalonsService {
  private readonly logger = new Logger(SalonsService.name);

  constructor(
    @InjectRepository(Salon) private readonly repo: Repository<Salon>,
    @InjectRepository(SalonCategory) private readonly salonCategories: Repository<SalonCategory>,
    @InjectRepository(ServiceCategory) private readonly serviceCategories: Repository<ServiceCategory>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly users: UsersService,
    private readonly adminNotifications: AdminNotificationsService,
    private readonly cities: CitiesService,
    // Appended at the end, same convention as BookingsService/PaymentsService's own
    // constructors -- every existing positional `new SalonsService(...)` call site
    // only needs an arg added at the tail, not threaded through the middle.
    private readonly analytics: AnalyticsService,
  ) {}

  /** Throws BadRequestException (not a raw FK-violation 500) for an id that doesn't exist. */
  private async requireValidCategoryIds(categoryIds: number[]): Promise<void> {
    const found = await this.serviceCategories.count({ where: { id: In(categoryIds) } });
    if (found !== categoryIds.length) {
      throw new BadRequestException('یک یا چند دسته‌بندی انتخاب‌شده معتبر نیست');
    }
  }

  // Resolves `city` to its canonical cities.id, same as before -- but this is now also
  // the one place that decides what to do about a NON-canonical city, so the decision
  // lives here rather than being duplicated at both call sites.
  //
  // Deliberately a WARNING, not a BadRequestException, even though a typo'd/non-canonical
  // city name is exactly the gap 24-technical-debt.md flags. Every real client today
  // (provider-panel's onboarding + settings forms) already only ever submits a name from
  // the live GET /cities list via a closed <AppSelect> dropdown (vue-multiselect with
  // allow-empty=false and no free-text/"taggable" escape hatch) -- so hard-rejecting would
  // add zero protection against any actual UI path. What it WOULD do is 400 every one of
  // this suite's ~30 e2e fixtures that create a salon with city: 'Tehran'/'Shiraz' (an
  // English transliteration, not a canonical Persian name) purely as unrelated setup for
  // some other feature under test -- see e.g. salons.e2e-spec.ts, bookings.e2e-spec.ts,
  // reviews.e2e-spec.ts. That's a real, sizeable, verified blast radius this repo's own
  // test suite would hit, not a hypothetical one, so this stays a logged warning (still
  // closes the "purely silent" half of the gap -- an ops-visible signal now exists where
  // none did before) until those fixtures are deliberately migrated to canonical names.
  private async resolveCityId(city: string, context: string): Promise<number | null> {
    const cityId = await this.cities.findIdByName(city);
    if (cityId === null) {
      this.logger.warn(`Non-canonical city "${city}" submitted for ${context}; city_id left NULL.`);
    }
    return cityId;
  }

  async createForOwner(ownerId: string, dto: CreateSalonDto): Promise<Salon> {
    const existing = await this.repo.findOneBy({ ownerId });
    if (existing) throw new ConflictException('You already have a salon');
    await this.requireValidCategoryIds(dto.categoryIds);
    const cityId = await this.resolveCityId(dto.city, `owner ${ownerId}`);

    const salon = await this.dataSource.transaction(async (em) => {
      const salon = await em.save(
        Salon,
        em.create(Salon, {
          ownerId,
          name: dto.name,
          slug: makeSlug(dto.name),
          description: dto.description ?? null,
          genderTarget: dto.genderTarget,
          address: dto.address,
          city: dto.city,
          cityId,
          capacity: dto.capacity ?? 1,
          location: { type: 'Point', coordinates: [dto.lng, dto.lat] },
        }),
      );
      await em.insert(
        SalonCategory,
        dto.categoryIds.map((categoryId) => ({ salonId: salon.id, categoryId })),
      );
      await this.users.promoteToProvider(ownerId);
      return salon;
    });

    // Fires only after the transaction above has genuinely committed (the salon row,
    // its category tags, and the owner's promotion are all durable) -- same
    // "already committed, cannot fail the request" guarantee as BookingsService's
    // booking_cancelled call. Best-effort and never awaited: an analytics outage
    // must add zero latency/failure risk to salon submission. No PII: salonId is a
    // bare id reference, categoryCount/genderTarget/hasDescription describe the
    // submission's shape without carrying the salon's actual name/address/contact.
    void this.analytics
      .track(
        'salon_submitted',
        {
          salonId: salon.id,
          categoryCount: dto.categoryIds.length,
          genderTarget: dto.genderTarget,
          hasDescription: Boolean(dto.description),
        },
        { userId: ownerId },
      )
      .catch(() => {});
    return salon;
  }

  async findMine(ownerId: string): Promise<Salon & { categories: SalonCategoryTag[] }> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('No salon for this account');
    const [withCategories] = await this.attachCategories([salon]);
    return withCategories;
  }

  async updateMine(salonId: string, dto: UpdateSalonDto): Promise<Salon & { categories: SalonCategoryTag[] }> {
    const salon = await this.repo.findOneBy({ id: salonId });
    if (!salon) throw new NotFoundException('No salon for this account');
    if (dto.categoryIds) await this.requireValidCategoryIds(dto.categoryIds);

    const { lat, lng, categoryIds, ...rest } = dto;
    // The validation pipe's plainToInstance defines EVERY dto field as an own property
    // (undefined when the client omitted it, ES2022 class-field semantics). Assigning
    // those undefineds onto the loaded entity makes repo.save() report null for columns
    // its UPDATE never touched -- the response would claim a field was cleared when the
    // DB kept it. Clearing is explicit: the dto transforms '' to null; absent stays put.
    Object.assign(salon, Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)));
    if (lat !== undefined && lng !== undefined) {
      salon.location = { type: 'Point', coordinates: [lng, lat] };
    }
    // Re-resolve cityId only when city itself is actually being changed -- re-running
    // this on every unrelated field update would be wasted work, and would also risk
    // clobbering a previously-resolved cityId with null if the (unchanged) city string
    // ever stopped matching due to a future rename of the canonical city list.
    if (dto.city !== undefined) {
      salon.cityId = await this.resolveCityId(dto.city, `salon ${salon.id}`);
    }

    await this.dataSource.transaction(async (em) => {
      await em.save(Salon, salon);
      // Delete-all-then-reinsert, not a diff -- this table is small (a handful of rows
      // per salon) and resolving to the caller's submitted set as the source of truth
      // is simpler and less error-prone than computing an add/remove delta.
      if (categoryIds) {
        await em.delete(SalonCategory, { salonId: salon.id });
        await em.insert(
          SalonCategory,
          categoryIds.map((categoryId) => ({ salonId: salon.id, categoryId })),
        );
      }
    });

    const [withCategories] = await this.attachCategories([salon]);
    return withCategories;
  }

  async resubmitMine(salonId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ id: salonId });
    if (!salon) throw new NotFoundException('Salon not found');
    if (salon.status !== 'rejected') {
      throw new BadRequestException('Only a rejected salon can be resubmitted');
    }
    // Guard against a concurrent admin action (approve or re-reject) on the same
    // salon landing between the read above and this write -- without conditioning
    // on the status still being 'rejected', an unconditional update({id}, ...) would
    // silently clobber whatever the admin just set, with no error to either caller.
    // Conditioning the update on the previously-read status (the same pattern used
    // by BookingsService's cancel()/updateStatus()) means only the winner's write
    // lands; a losing concurrent call gets a clear 409 instead of a misleading 200.
    const result = await this.repo.update(
      { id: salon.id, status: 'rejected' },
      { status: 'pending', rejectionReason: null },
    );
    if (!result.affected) {
      throw new ConflictException('Salon status changed before this resubmission could be applied');
    }
    const updated = (await this.repo.findOneBy({ id: salon.id }))!;

    // Tell admins a rejected salon is back in the review queue (spec 3.6). This is
    // a fire-safe side effect: emit() throws on failure by contract, but a lost
    // notification must never fail the owner's resubmission, so it is logged and
    // swallowed here.
    try {
      await this.adminNotifications.emit(
        'salon_resubmitted',
        `سالن «${updated.name}» دوباره برای بررسی ارسال شد`,
        'مالک سالن پس از رد شدن، اطلاعات را ویرایش و درخواست بررسی مجدد ثبت کرده است.',
        `/salons/${updated.id}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to emit salon_resubmitted notification for salon ${updated.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return updated;
  }

  async findPublicBySlug(slug: string): Promise<Salon & { categories: SalonCategoryTag[] }> {
    const salon = await this.repo.findOneBy({ slug, status: 'approved' });
    if (!salon) throw new NotFoundException();
    const [withCategories] = await this.attachCategories([salon]);
    return withCategories;
  }

  findById(id: string): Promise<Salon | null> {
    return this.repo.findOneBy({ id });
  }

  // --- Admin moderation (moved out of AdminSalonsController, which previously ran these
  // as raw repository calls directly in the handler -- every other salon mutation in this
  // service already goes through validation/transaction structure here, and admin actions
  // are no different: the "can't approve a suspended owner's salon" rule belongs next to
  // the rest of this aggregate's business rules, not embedded in an HTTP controller.

  async setStatus(id: string, dto: UpdateSalonStatusDto): Promise<Salon> {
    if (dto.status === 'approved') {
      const salon = await this.repo.findOneBy({ id });
      if (!salon) throw new NotFoundException();
      const owner = await this.users.findById(salon.ownerId);
      if (owner?.status === 'suspended') {
        // Persian: this message is surfaced verbatim by the admin panel's toast.
        throw new ConflictException('تایید این آرایشگاه ممکن نیست؛ حساب مالک آن معلق است');
      }
    }
    const patch: Partial<Salon> = {
      status: dto.status,
      rejectionReason: dto.status === 'approved' ? null : (dto.reason ?? null),
    };
    // suspended_cause bookkeeping (Plan 7 spec 3.5): a direct admin suspension is marked
    // 'admin' so a later owner reactivation will NOT auto-restore this salon; approving
    // (from any prior state) clears the cause. Rejection leaves it untouched -- so a
    // rejected/pending salon may carry a stale 'owner_suspended' cause until its next
    // approve/suspend scrubs it. Harmless: the reactivation cascade also requires
    // status='suspended', so a stale cause on any other status can never trigger a restore.
    if (dto.status === 'suspended') patch.suspendedCause = 'admin';
    if (dto.status === 'approved') patch.suspendedCause = null;
    const result = await this.repo.update({ id }, patch);
    if (!result.affected) throw new NotFoundException();
    return (await this.repo.findOneBy({ id }))!;
  }

  async setFeatured(id: string, dto: SetFeaturedDto): Promise<Salon> {
    const result = await this.repo.update(
      { id },
      { isFeatured: dto.isFeatured, featuredUntil: dto.featuredUntil ? new Date(dto.featuredUntil) : null },
    );
    if (!result.affected) throw new NotFoundException();
    return (await this.repo.findOneBy({ id }))!;
  }

  // Manual join, not an ORM relation -- matches this codebase's existing repo
  // convention (see BookingsService.attachNames). Batches all salons in one query
  // regardless of caller size, though every current caller passes a single salon.
  private async attachCategories<T extends { id: string }>(
    salons: T[],
  ): Promise<Array<T & { categories: SalonCategoryTag[] }>> {
    if (salons.length === 0) return [];
    const salonIds = salons.map((s) => s.id);
    const rows = await this.salonCategories
      .createQueryBuilder('sc')
      .innerJoin(ServiceCategory, 'cat', 'cat.id = sc.category_id')
      .where('sc.salon_id IN (:...salonIds)', { salonIds })
      .select(['sc.salonId AS salon_id', 'cat.id AS id', 'cat.name AS name', 'cat.icon AS icon'])
      // Matches search.service.ts's own category-tags ordering (ORDER BY sc.name via
      // json_agg) -- these two independently-implemented reads of the same
      // salon_categories/service_categories join previously disagreed on order (this one
      // had none at all, so it fell out however Postgres happened to return the join),
      // an unintentional inconsistency between a salon's search-result badges and its own
      // detail/create/update response, not a deliberate design choice.
      .orderBy('cat.name', 'ASC')
      .getRawMany<{ salon_id: string; id: number; name: string; icon: string }>();

    const bySalonId = new Map<string, SalonCategoryTag[]>();
    for (const row of rows) {
      const tag: SalonCategoryTag = { id: row.id, name: row.name, icon: row.icon };
      const existing = bySalonId.get(row.salon_id);
      if (existing) existing.push(tag);
      else bySalonId.set(row.salon_id, [tag]);
    }

    return salons.map((s) => ({ ...s, categories: bySalonId.get(s.id) ?? [] }));
  }
}
