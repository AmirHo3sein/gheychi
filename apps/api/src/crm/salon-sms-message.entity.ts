import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Append-only log of salon-initiated customer SMS -- see customer-sms.service.ts. Also the
// quota-usage source of truth: COUNT(*) within the current Jalali month, no separate counter.
// Phase 6 of the monetization initiative (docs/technical-overview/33-salon-sms-quota.md).
@Entity('salon_sms_messages')
export class SalonSmsMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ type: 'varchar', length: 20 })
  phone: string;

  @Column({ type: 'varchar', length: 500 })
  message: string;

  @Column({ name: 'sent_by' })
  sentBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
