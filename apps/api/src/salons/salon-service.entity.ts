import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { nullableBigintToNumber } from '../common/numeric-transformers';
import { PricingType } from './service-pricing.util';

@Entity('salon_services')
export class SalonService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  // Exactly one of categoryId/customCategoryId is set (DB CHECK
  // salon_services_category_shape_chk) -- a system category or the salon's own private one.
  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  @Column({ name: 'custom_category_id', type: 'uuid', nullable: true })
  customCategoryId: string | null;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'pricing_type', type: 'varchar', default: 'fixed' })
  pricingType: PricingType;

  // FIXED: the price. FROM: the starting/floor price. RANGE: the range minimum. QUOTE: null
  // (see service-pricing.util.ts's validatePricingShape / the DB shape CHECK it mirrors).
  @Column({ type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  price: number | null;

  // RANGE's ceiling only; null for every other pricing type.
  @Column({ name: 'price_max', type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  priceMax: number | null;

  @Column({ name: 'duration_min', type: 'int' })
  durationMin: number;

  // Purely informational ("takes about 2-4 hours") -- the booking/availability engine only
  // ever reads durationMin; this is never consulted by computeAvailableSlots.
  @Column({ name: 'duration_max', type: 'int', nullable: true })
  durationMax: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Only ever non-null when pricingType === 'fixed' (DB CHECK
  // salon_services_discount_fixed_only_chk) -- discounting a price that isn't fixed would
  // misrepresent what the customer actually pays.
  @Column({ name: 'discount_percent', type: 'int', nullable: true })
  discountPercent: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
