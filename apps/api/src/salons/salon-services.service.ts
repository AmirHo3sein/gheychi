import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateServiceDto, UpdateServiceDto } from './dto/salon-service.dto';
import { SalonCustomCategory } from './salon-custom-category.entity';
import { SalonService } from './salon-service.entity';
import {
  reconcilePricingOnUpdate, validateDiscountForPricingType, validateDurationRange, validatePricingShape,
} from './service-pricing.util';

@Injectable()
export class SalonServicesService {
  constructor(
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(SalonCustomCategory) private readonly customCategories: Repository<SalonCustomCategory>,
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

    Object.assign(service, {
      categoryId,
      customCategoryId,
      name: dto.name ?? service.name,
      description: dto.description !== undefined ? dto.description : service.description,
      ...reconciled,
      durationMin,
      durationMax,
    });
    return this.services.save(service);
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
