import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * An admin-configurable subscription tier. FREE/PLUS/PREMIUM are the launch examples, not
 * hardcoded concepts -- name, price, and every entitlement are editable via
 * PATCH /admin/plans, matching the monetization initiative's "admin is the central
 * commercial-policy control plane" decision (see
 * docs/superpowers/specs/2026-08-30-monetization-platform-design.md).
 */
@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Internal, stable identifier -- set at creation only (absent from UpdatePlanDto,
  // deliberately, same reasoning as salon.slug's current immutability): later phases
  // (entitlement enforcement, CRM/SMS gating) will branch on this in code paths, and
  // letting an admin freely rename it out from under that code would silently break
  // whichever entitlement check keyed off it. `name` (the display label) is freely
  // editable; `key` is not.
  @Column({ unique: true })
  key: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'monthly_price_toman', type: 'int', default: 0 })
  monthlyPriceToman: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Exactly one plan may carry this at a time -- DB-backstopped (see the migration's
  // partial unique index), not just an app-level convention. Used as (a) the plan a newly
  // created salon starts on (SubscriptionsService.createDefaultSubscription) and (b) the
  // fallback a salon's entitlements resolve to if its own subscription is ever canceled or
  // missing (SubscriptionsService.getEntitlements) -- a salon must never be left with no
  // resolvable plan at all.
  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  // Open bag, not a fixed set of typed columns: the specific keys a plan constrains (SMS
  // quota, CRM customer cap, custom-handle access, ...) belong to the LATER phases that
  // actually enforce them (see the monetization spec's phase order) -- this column exists
  // now so the plan/subscription backbone is stable, without this phase inventing meaning
  // for keys nothing reads yet.
  @Column({ type: 'jsonb', default: {} })
  entitlements: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
