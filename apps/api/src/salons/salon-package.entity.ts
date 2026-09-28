import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { nullableBigintToNumber } from '../common/numeric-transformers';
import { PricingType } from './service-pricing.util';

// Catalog/display concept only -- a package is never itself booked, paid for, refunded, or
// commissioned. Each constituent service (see SalonPackageItem) still goes through the
// existing, unchanged single-service booking flow; price/priceMax/durationMin/durationMax
// here are purely informational and never consulted by the booking/availability engine.
// See service-pricing.util.ts for the shared pricing-type shape rules (same DB CHECK shape
// as SalonService, migration 1756900000000).
@Entity('salon_packages')
export class SalonPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'pricing_type', type: 'varchar', default: 'quote' })
  pricingType: PricingType;

  @Column({ type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  price: number | null;

  @Column({ name: 'price_max', type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  priceMax: number | null;

  @Column({ name: 'duration_min', type: 'int', nullable: true })
  durationMin: number | null;

  @Column({ name: 'duration_max', type: 'int', nullable: true })
  durationMax: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
