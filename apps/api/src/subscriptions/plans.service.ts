import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/postgres-error-codes';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { Plan } from './plan.entity';

export interface PlanWithSubscriberCount extends Plan {
  /** Count of `active` salon_subscriptions rows on this plan right now -- a `canceled`
   *  subscription's `plan_id` is left stale (see SalonSubscription's own doc comment), so
   *  counting it here would overstate who is actually affected by editing this plan. */
  subscriberCount: number;
}

export interface PlanSalonSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
}

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan) private readonly repo: Repository<Plan>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // Subscriber counts, not just the plan list: before this, an admin had no way to see the
  // blast radius of editing or deactivating a plan without opening every salon's detail
  // page individually. One raw query, not per-plan N+1 -- a LEFT JOIN so a plan with zero
  // subscribers still gets a row (COUNT of no matching right-side rows is 0, not omitted).
  // Raw SQL against `salon_subscriptions` rather than a Salon-entity join: this module
  // deliberately has no dependency on SalonsModule (see subscriptions.module.ts's own
  // comment) so SalonsModule can import this one without a cycle.
  async list(): Promise<PlanWithSubscriberCount[]> {
    const plans = await this.repo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    const counts: Array<{ plan_id: string; count: string }> = await this.dataSource.query(
      `SELECT plan_id, COUNT(*) AS count FROM salon_subscriptions WHERE status = 'active' GROUP BY plan_id`,
    );
    const countByPlanId = new Map(counts.map((row) => [row.plan_id, Number(row.count)]));
    return plans.map((plan) => ({ ...plan, subscriberCount: countByPlanId.get(plan.id) ?? 0 }));
  }

  /** Which salons are actually on this plan right now -- the detail behind list()'s count,
   *  for an admin about to edit or deactivate it. */
  async listSalons(planId: string): Promise<PlanSalonSummary[]> {
    const plan = await this.repo.findOneBy({ id: planId });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.dataSource.query(
      `SELECT s.id, s.name, s.slug, s.status
       FROM salons s
       JOIN salon_subscriptions ss ON ss.salon_id = s.id
       WHERE ss.plan_id = $1 AND ss.status = 'active'
       ORDER BY s.name ASC`,
      [planId],
    );
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
