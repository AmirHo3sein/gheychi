import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { Plan } from './plan.entity';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly repo: Repository<Plan>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  list(): Promise<Plan[]> {
    return this.repo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async create(dto: CreatePlanDto): Promise<Plan> {
    try {
      return await this.repo.save(
        this.repo.create({
          key: dto.key,
          name: dto.name,
          description: dto.description ?? null,
          monthlyPriceToman: dto.monthlyPriceToman ?? 0,
          entitlements: dto.entitlements ?? {},
          sortOrder: dto.sortOrder ?? 0,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('پلنی با این شناسه از قبل وجود دارد');
      throw err;
    }
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.repo.findOneBy({ id });
    if (!plan) throw new NotFoundException('Plan not found');
    if (dto.isDefault === false && plan.isDefault) {
      throw new ConflictException('حداقل یک پلن باید پیش‌فرض باشد؛ به‌جای غیرفعال کردن، پلن دیگری را پیش‌فرض کنید');
    }
    // The default plan is what every new salon lands on (createDefaultSubscription reads
    // isDefault only) and what assignPlan() refuses to assign when inactive -- the two must
    // never disagree, so a plan can't be default and inactive at the same time.
    const willBeDefault = dto.isDefault ?? plan.isDefault;
    const willBeActive = dto.isActive ?? plan.isActive;
    if (willBeDefault && !willBeActive) {
      throw new ConflictException('پلن پیش‌فرض نمی‌تواند غیرفعال باشد؛ ابتدا پلن دیگری را پیش‌فرض کنید');
    }

    return this.dataSource.transaction(async (em) => {
      if (dto.isDefault === true && !plan.isDefault) {
        // Exactly one plan may be default at a time (DB-backstopped, see the migration's
        // partial unique index) -- unset every other row first, in the same transaction,
        // mirroring the "setting a new cover photo unsets every other cover row" precedent
        // (salon-photos.service.ts).
        await em.createQueryBuilder().update(Plan).set({ isDefault: false }).where('is_default = true').execute();
      }
      await em.update(Plan, { id }, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.monthlyPriceToman !== undefined ? { monthlyPriceToman: dto.monthlyPriceToman } : {}),
        // TypeORM's QueryDeepPartialEntity recurses into a plain Record<string, unknown>
        // jsonb column and rejects it -- same `as any` escape hatch already used for
        // AnalyticsEvent.properties (postgres-analytics.provider.ts), the codebase's other
        // open jsonb bag.
        ...(dto.entitlements !== undefined ? { entitlements: dto.entitlements as any } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      });
      return (await em.findOneBy(Plan, { id }))!;
    });
  }

  async remove(id: string): Promise<void> {
    const plan = await this.repo.findOneBy({ id });
    if (!plan) throw new NotFoundException('Plan not found');
    // Checked explicitly rather than relying solely on the FK below: a brand-new default
    // plan with zero subscriptions yet would otherwise delete cleanly and leave the
    // platform with no fallback plan at all.
    if (plan.isDefault) throw new ConflictException('پلن پیش‌فرض قابل حذف نیست');
    try {
      await this.repo.delete(id);
    } catch (err) {
      // Same restrict semantics as category delete: a plan referenced by any salon's
      // subscription cannot be deleted, enforced by the database's own FK behavior.
      if (isForeignKeyViolation(err)) {
        throw new ConflictException('این پلن توسط سالن‌هایی استفاده می‌شود و قابل حذف نیست');
      }
      throw err;
    }
  }
}
