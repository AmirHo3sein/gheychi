import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('salon_services')
export class SalonService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'category_id', type: 'int' })
  categoryId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  price: number;

  @Column({ name: 'duration_min', type: 'int' })
  durationMin: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'discount_percent', type: 'int', nullable: true })
  discountPercent: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
