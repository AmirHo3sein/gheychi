import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type GenderTarget = 'women' | 'men';
export type SalonStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

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

  @Column({ name: 'gender_target', type: 'varchar' })
  genderTarget: GenderTarget;

  @Column({ type: 'varchar', default: 'pending' })
  status: SalonStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'suspended_cause', type: 'varchar', length: 20, nullable: true })
  suspendedCause: 'admin' | 'owner_suspended' | null;

  @Column({ type: 'text' })
  address: string;

  @Column()
  city: string;

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
