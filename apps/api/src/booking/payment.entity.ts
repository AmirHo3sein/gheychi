import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type PaymentStatus = 'initiated' | 'paid' | 'failed' | 'refunded';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', unique: true })
  bookingId: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  amount: number;

  @Column({ type: 'varchar', default: 'zarinpal' })
  gateway: string;

  @Column({ type: 'varchar', nullable: true })
  authority: string | null;

  @Column({ name: 'ref_id', type: 'varchar', nullable: true })
  refId: string | null;

  @Column({ type: 'varchar', default: 'initiated' })
  status: PaymentStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
