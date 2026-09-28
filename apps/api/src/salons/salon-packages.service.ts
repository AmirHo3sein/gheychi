import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CreatePackageDto, UpdatePackageDto } from './dto/salon-package.dto';
import { SalonPackageItem } from './salon-package-item.entity';
import { SalonPackage } from './salon-package.entity';
import { SalonService } from './salon-service.entity';
import { reconcilePricingOnUpdate, validatePackageDurationShape, validatePricingShape } from './service-pricing.util';

@Injectable()
export class SalonPackagesService {
  constructor(
    @InjectRepository(SalonPackage) private readonly packages: Repository<SalonPackage>,
    @InjectRepository(SalonPackageItem) private readonly items: Repository<SalonPackageItem>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly dataSource: DataSource,
  ) {}

  async list(salonId: string): Promise<SalonPackage[]> {
    return this.packages.find({ where: { salonId, isActive: true }, order: { createdAt: 'ASC' } });
  }

  async itemsFor(packageId: string): Promise<SalonPackageItem[]> {
    return this.items.find({ where: { packageId }, order: { sortOrder: 'ASC' } });
  }

  async create(salonId: string, dto: CreatePackageDto): Promise<SalonPackage> {
    const price = dto.price ?? null;
    const priceMax = dto.priceMax ?? null;
    validatePricingShape({ pricingType: dto.pricingType, price, priceMax });
    validatePackageDurationShape(dto.durationMin ?? null, dto.durationMax ?? null);
    await this.assertOwnsAllServices(salonId, dto.serviceIds);

    return this.dataSource.transaction(async (em) => {
      const pkg = await em.save(
        em.create(SalonPackage, {
          salonId,
          name: dto.name,
          description: dto.description ?? null,
          pricingType: dto.pricingType,
          price,
          priceMax,
          durationMin: dto.durationMin ?? null,
          durationMax: dto.durationMax ?? null,
        }),
      );
      await em.insert(
        SalonPackageItem,
        dto.serviceIds.map((serviceId, sortOrder) => ({ packageId: pkg.id, serviceId, sortOrder })),
      );
      return pkg;
    });
  }

  async update(salonId: string, id: string, dto: UpdatePackageDto): Promise<SalonPackage> {
    const pkg = await this.packages.findOneBy({ id, salonId, isActive: true });
    if (!pkg) throw new NotFoundException();

    const reconciled = reconcilePricingOnUpdate(
      { pricingType: pkg.pricingType, price: pkg.price, priceMax: pkg.priceMax, discountPercent: null },
      { pricingType: dto.pricingType, price: dto.price, priceMax: dto.priceMax },
    );
    validatePricingShape(reconciled);

    const durationMin = dto.durationMin !== undefined ? dto.durationMin : pkg.durationMin;
    const durationMax = dto.durationMax !== undefined ? dto.durationMax : pkg.durationMax;
    validatePackageDurationShape(durationMin, durationMax);

    if (dto.serviceIds) await this.assertOwnsAllServices(salonId, dto.serviceIds);

    return this.dataSource.transaction(async (em) => {
      Object.assign(pkg, {
        name: dto.name ?? pkg.name,
        description: dto.description !== undefined ? dto.description : pkg.description,
        pricingType: reconciled.pricingType,
        price: reconciled.price,
        priceMax: reconciled.priceMax,
        durationMin,
        durationMax,
      });
      const saved = await em.save(pkg);

      if (dto.serviceIds) {
        // Full-replace, not a diff -- matches how the provider-panel form always submits
        // the complete current selection (see CreatePackageDto's own doc comment).
        await em.delete(SalonPackageItem, { packageId: id });
        await em.insert(
          SalonPackageItem,
          dto.serviceIds.map((serviceId, sortOrder) => ({ packageId: id, serviceId, sortOrder })),
        );
      }
      return saved;
    });
  }

  async archive(salonId: string, id: string): Promise<void> {
    const result = await this.packages.update({ id, salonId }, { isActive: false });
    if (!result.affected) throw new NotFoundException();
  }

  private async assertOwnsAllServices(salonId: string, serviceIds: string[]): Promise<void> {
    const count = await this.services.count({ where: { salonId, id: In(serviceIds) } });
    if (count !== serviceIds.length) {
      throw new BadRequestException('همه خدمات انتخاب‌شده باید متعلق به سالن شما باشند');
    }
  }
}
