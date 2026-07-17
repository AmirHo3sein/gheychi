import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type PortfolioItemStatus = 'published' | 'removed';

@Entity('portfolio_items')
export class PortfolioItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column()
  url: string;

  @Column({ name: 'storage_key' })
  storageKey: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  caption: string | null;

  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @Column({ type: 'varchar', default: 'published' })
  status: PortfolioItemStatus;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
