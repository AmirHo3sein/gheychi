import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Salon-private -- never surfaced to the customer themselves or to admin. Phase 5 of the
// monetization initiative (docs/technical-overview/32-salon-crm.md).
@Entity('customer_notes')
export class CustomerNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ type: 'varchar', length: 1000 })
  note: string;

  @Column({ name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
