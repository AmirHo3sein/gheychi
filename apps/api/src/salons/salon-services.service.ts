import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { STORAGE_PROVIDER, StorageProvider } from '../storage/storage.provider';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonCustomCategory } from './salon-custom-category.entity';
import { SalonService } from './salon-service.entity';
import { normalizeServiceImage, SERVICE_IMAGE_CONTENT_TYPE } from './service-image.util';
import {
  reconcilePricingOnUpdate, validateDiscountForPricingType, validateDurationRange, validatePricingShape,
} from './service-pricing.util';

const CLEARED_IMAGE: Pick<SalonService, 'imageUrl' | 'imageStorageKey'> = { imageUrl: null, imageStorageKey: null };

@Injectable()
export class SalonServicesService {
  private readonly logger = new Logger(SalonServicesService.name);

  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(SalonCustomCategory) private readonly customCategories: Repository<SalonCustomCategory>,
    private readonly dataSource: DataSource,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async create(salonId: string, dto: CreateServiceDto): Promise<SalonService> {
    const categoryId = dto.categoryId ?? null;
    const customCategoryId = dto.customCategoryId ?? null;
    this.validateCategoryChoice(categoryId, customCategoryId);
    if (customCategoryId) await this.assertOwnsCustomCategory(salonId, customCategoryId);

    const price = dto.price ?? null;
    const priceMax = dto.priceMax ?? null;
    validatePricingShape({ pricingType: dto.pricingType, price, priceMax });
    validateDiscountForPricingType(dto.pricingType, dto.discountPercent ?? null);
    validateDurationRange(dto.durationMin, dto.durationMax ?? null);

    const service = this.services.create({
      salonId,
      categoryId,
      customCategoryId,
      name: dto.name,
      description: dto.description ?? null,
      pricingType: dto.pricingType,
      price,
      priceMax,
      durationMin: dto.durationMin,
      durationMax: dto.durationMax ?? null,
      discountPercent: dto.discountPercent ?? null,
    });
    return this.services.save(service);
  }

  async update(salonId: string, id: string, dto: UpdateServiceDto): Promise<SalonService> {
    const service = await this.services.findOneBy({ id, salonId, isActive: true });
    if (!service) throw new NotFoundException();

    // Category: switching to one clears the other, exactly like the pricing-type
    // reconciliation below -- never leaves both/neither set (DB shape CHECK backstop).
    let categoryId = service.categoryId;
    let customCategoryId = service.customCategoryId;
    if (dto.categoryId !== undefined) {
      categoryId = dto.categoryId;
      customCategoryId = null;
    } else if (dto.customCategoryId !== undefined) {
      await this.assertOwnsCustomCategory(salonId, dto.customCategoryId);
      customCategoryId = dto.customCategoryId;
      categoryId = null;
    }
    this.validateCategoryChoice(categoryId, customCategoryId);

    const reconciled = reconcilePricingOnUpdate(
      { pricingType: service.pricingType, price: service.price, priceMax: service.priceMax, discountPercent: service.discountPercent },
      { pricingType: dto.pricingType, price: dto.price, priceMax: dto.priceMax, discountPercent: dto.discountPercent },
    );
    validatePricingShape(reconciled);
    validateDiscountForPricingType(reconciled.pricingType, reconciled.discountPercent);

    const durationMin = dto.durationMin ?? service.durationMin;
    const durationMax = dto.durationMax !== undefined ? dto.durationMax : service.durationMax;
    validateDurationRange(durationMin, durationMax);

    // A targeted UPDATE of exactly the DTO-editable columns, never save(service): save()
    // diffs the entity read above against the row as it is NOW, so an image swap
    // (setImage/removeImage) committing in between would be "reverted" -- the row would
    // point back at the old object setImage has already deleted, and the new one would be
    // orphaned. The isActive guard likewise keeps a concurrent archive from being undone.
    const result = await this.services.update(
      { id, salonId, isActive: true },
      {
        categoryId,
        customCategoryId,
        name: dto.name ?? service.name,
        description: dto.description !== undefined ? dto.description : service.description,
        ...reconciled,
        durationMin,
        durationMax,
      },
    );
    if (!result.affected) throw new NotFoundException();
    return this.services.findOneByOrFail({ id, salonId });
  }

  /**
   * Sets (or replaces) a service's primary image. Order is load-bearing:
   *  1. normalize (sharp re-encode -- rejects before anything is stored),
   *  2. upload under a fresh, never-reused key,
   *  3. swap the row's url/key under a row lock, scoped to {id, salonId, isActive} so another
   *     salon's id 404s without ever being touched,
   *  4. only AFTER commit, best-effort delete the previous object.
   * If step 3 fails for any reason the just-uploaded object is removed and the error
   * rethrown; the previous object is never deleted before the row stops referencing it, so
   * a failure at any point leaves the service showing a real image. Anything a crash leaves
   * behind is unreferenced and swept by StorageReconciliationJob after its grace period.
   * A successful upload also clears imageRemovedByAdminAt: the owner has acted on the
   * takedown notice, so the provider panel stops showing it.
   */
  async setImage(salonId: string, id: string, input: Buffer): Promise<SalonService> {
    const jpeg = await normalizeServiceImage(input);
    const key = `salons/${salonId}/services/${id}/${randomUUID()}.jpg`;
    const url = await this.storage.upload(jpeg, key, SERVICE_IMAGE_CONTENT_TYPE);

    let previousKey: string | null;
    let saved: SalonService;
    try {
      ({ previousKey, saved } = await this.swapImage(salonId, id, { imageUrl: url, imageStorageKey: key }));
    } catch (err) {
      await this.deleteStorageObject(key, id, salonId, 'newly uploaded image of a failed update');
      throw err;
    }
    if (previousKey) await this.deleteStorageObject(previousKey, id, salonId, 'replaced image');
    return saved;
  }

  /**
   * Clears a service's image (and any admin-takedown notice -- the owner acted on the
   * image, so the notice is no longer relevant). Idempotent: a service with no image and
   * no notice is returned unchanged.
   */
  async removeImage(salonId: string, id: string): Promise<SalonService> {
    const { previousKey, saved } = await this.swapImage(salonId, id, { imageUrl: null, imageStorageKey: null });
    if (previousKey) await this.deleteStorageObject(previousKey, id, salonId, 'removed image');
    return saved;
  }

  /**
   * Archives a service (the owner's DELETE salons/mine/services/:id) and, in the same
   * locked transaction, clears its image; the object is deleted only after commit. Keeping
   * the image of an archived service served no one and left a public file its owner could
   * never withdraw:
   *  - nothing un-archives a service: the owner list (SalonServicesController.list) and
   *    every other mutation path filter is_active = true, and no reactivate endpoint exists;
   *  - no surface renders an archived service's image: the public services list, booking
   *    page and Beauty Guide all filter is_active, and booking/history responses never carry
   *    a service image at all (the admin salon detail lists it, but only for moderation).
   * The DB enforces it too (CHECK salon_services_archived_no_image_chk, migration
   * 1758300000000, which also cleared the images of rows archived before this rule), so
   * isActive=false and the cleared image must land in this one save.
   * Not-yet-owned/already-archived semantics are unchanged: another salon's id 404s, an
   * already-archived row of this salon succeeds again.
   */
  async archive(salonId: string, id: string): Promise<void> {
    const { previousKey } = await this.mutateLocked({ id, salonId }, (service) => ({
      isActive: false,
      ...(service.imageStorageKey ? CLEARED_IMAGE : {}),
    }));
    if (previousKey) await this.deleteStorageObject(previousKey, id, salonId, 'image of an archived service');
  }

  /**
   * Admin takedown of a service image (DELETE admin/services/:id/image). The row is
   * addressed by id alone, but an archived row can no longer hold an image (DB CHECK
   * salon_services_archived_no_image_chk), so in practice only an active one gets past the
   * 409 below. Same storage lifecycle as removeImage(): both columns cleared under a row
   * lock, object deleted best-effort after commit. In the same locked transaction it stamps
   * imageRemovedByAdminAt -- the owner's notice in the provider panel (no SMS: cost; there
   * is no provider in-app notification feed to post to). Touches nothing else on the row.
   * Unlike the owner path this is not idempotent: a row with no image is a 409, so a
   * second admin racing the first gets a clear conflict (audited as a failed attempt by
   * AuditInterceptor) rather than a second successful removal.
   *
   * Deleting the object is safe because image keys are per-upload and never shared:
   * `salons/{salonId}/services/{serviceId}/{uuid}.jpg` (setImage above). No other table
   * stores a key under that prefix -- salon_photos use `salons/{salonId}/{uuid}`, portfolio
   * `salons/{salonId}/portfolio/`, stories `salons/{salonId}/stories/`, blog covers `blog/`,
   * and Beauty Guide images live in a separate private store.
   */
  async adminRemoveImage(id: string): Promise<{ before: SalonService; saved: SalonService }> {
    const { before, saved, previousKey } = await this.mutateLocked({ id }, (service) => {
      if (!service.imageStorageKey) throw new ConflictException('این خدمت تصویری ندارد');
      return { ...CLEARED_IMAGE, imageRemovedByAdminAt: new Date() };
    });
    if (previousKey) await this.deleteStorageObject(previousKey, id, saved.salonId, 'image removed by an admin');
    return { before, saved };
  }

  private async swapImage(
    salonId: string,
    id: string,
    next: Pick<SalonService, 'imageUrl' | 'imageStorageKey'>,
  ): Promise<{ previousKey: string | null; saved: SalonService }> {
    // Every owner image action also clears the admin-takedown notice.
    const { previousKey, saved } = await this.mutateLocked({ id, salonId, isActive: true }, (service) =>
      service.imageStorageKey === next.imageStorageKey && !service.imageRemovedByAdminAt
        ? null
        : { ...next, imageRemovedByAdminAt: null },
    );
    return { previousKey, saved };
  }

  /**
   * The one locked read-modify-write every image/archive mutation goes through: lock the
   * row matching `where` (404 if none), let `decide` return the patch (or null for a
   * no-op, or throw), save, commit. `previousKey` is the storage key the row stopped
   * referencing -- the caller deletes it only after this resolves, i.e. after commit, so a
   * failed transaction never loses the object a row still points at.
   */
  private mutateLocked(
    where: FindOptionsWhere<SalonService>,
    decide: (service: SalonService) => Partial<SalonService> | null,
  ): Promise<{ before: SalonService; saved: SalonService; previousKey: string | null }> {
    return this.dataSource.transaction(async (manager) => {
      const service = await manager.findOne(SalonService, { where, lock: { mode: 'pessimistic_write' } });
      if (!service) throw new NotFoundException();
      const before = { ...service };
      const patch = decide(service);
      if (!patch) return { before, saved: service, previousKey: null };
      Object.assign(service, patch);
      const saved = await manager.save(service);
      const previousKey = before.imageStorageKey !== saved.imageStorageKey ? before.imageStorageKey : null;
      return { before, saved, previousKey };
    });
  }

  // Best-effort: the row is the source of truth for what's shown; an orphaned object is a
  // cleanup gap (reconciliation sweeps it), never a reason to fail the request -- same
  // policy as portfolio/photo deletes.
  private async deleteStorageObject(key: string, serviceId: string, salonId: string, what: string): Promise<void> {
    await this.storage.delete(key).catch((err) => {
      this.logger.error(
        `Failed to delete storage object ${key} (${what}) for service ${serviceId} (salon ${salonId}) -- object may be orphaned`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private validateCategoryChoice(categoryId: number | null, customCategoryId: string | null): void {
    if ((categoryId !== null) === (customCategoryId !== null)) {
      throw new BadRequestException('باید دقیقاً یکی از دسته‌بندی سیستمی یا سفارشی انتخاب شود');
    }
  }

  private async assertOwnsCustomCategory(salonId: string, customCategoryId: string): Promise<void> {
    const owned = await this.customCategories.existsBy({ id: customCategoryId, salonId });
    if (!owned) throw new ForbiddenException('این دسته‌بندی سفارشی متعلق به سالن شما نیست');
  }
}
