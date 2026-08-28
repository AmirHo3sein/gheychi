import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BookingConfirmationMode } from '../booking/booking.entity';

export type GenderTarget = 'women' | 'men';
export type SalonStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type SuspendedCause = 'admin' | 'owner_suspended';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

@Entity('salons')
export class Salon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id' })
  ownerId: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  tagline: string | null;

  @Column({ type: 'text', nullable: true })
  about: string | null;

  @Column({ name: 'instagram_handle', type: 'varchar', length: 30, nullable: true })
  instagramHandle: string | null;

  @Column({ name: 'gender_target', type: 'varchar' })
  genderTarget: GenderTarget;

  @Column({ type: 'varchar', default: 'pending' })
  status: SalonStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'suspended_cause', type: 'varchar', length: 20, nullable: true })
  suspendedCause: SuspendedCause | null;

  @Column({ type: 'text' })
  address: string;

  @Column()
  city: string;

  // Nullable, best-effort link to cities.id -- resolved by SalonsService from `city` on
  // create/update via an exact name match. `city` (above) stays the display/source of
  // truth; this is a purely additive enrichment, NULL for any salon whose city isn't one
  // of the curated canonical names (see the 1754300000000-cities-table migration).
  @Column({ name: 'city_id', type: 'int', nullable: true })
  cityId: number | null;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: GeoPoint;

  @Column({ type: 'int', default: 1 })
  capacity: number;

  @Column({ name: 'rating_avg', type: 'numeric', precision: 3, scale: 2, default: 0 })
  ratingAvg: string;

  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

  @Column({ name: 'featured_until', type: 'timestamptz', nullable: true })
  featuredUntil: Date | null;

  // The ONE booking setting a salon owner controls (PATCH /salons/mine).
  // 'automatic' (the default, and every salon that existed before this column) keeps the
  // original behaviour exactly: pay, then confirmed. 'manual_approval' inserts a
  // salon-decision step before any payment is taken.
  @Column({ name: 'booking_confirmation_mode', type: 'varchar', default: 'automatic' })
  bookingConfirmationMode: BookingConfirmationMode;

  // Admin-only per-salon overrides of the global timeout defaults. NULL = inherit the
  // platform_config value.
  //
  // These are deliberately NOT on UpdateSalonDto: SalonsService.updateMine() applies its
  // DTO with a blanket `Object.assign(salon, ...)`, so merely *adding* a field there
  // would silently hand providers the ability to set their own deadlines. They are
  // writable only through the admin-guarded PATCH /admin/salons/:id/booking-settings.
  @Column({ name: 'approval_timeout_minutes', type: 'int', nullable: true })
  approvalTimeoutMinutes: number | null;

  @Column({ name: 'payment_timeout_minutes', type: 'int', nullable: true })
  paymentTimeoutMinutes: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
