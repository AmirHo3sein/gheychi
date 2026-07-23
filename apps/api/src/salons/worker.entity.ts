import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('workers')
export class Worker {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // numeric(3,2) -- TypeORM returns Postgres numeric columns as strings by default
  // (matches Salon.ratingAvg's exact handling, see salon.entity.ts).
  @Column({ name: 'rating_avg', type: 'numeric', precision: 3, scale: 2, default: 0 })
  ratingAvg: string;

  @Column({ name: 'rating_count', type: 'int', default: 0 })
  ratingCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
