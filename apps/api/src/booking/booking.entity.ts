import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'cancelled_by_user'
  | 'cancelled_by_salon'
  | 'expired'
  | 'no_show';

const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'service_id' })
  serviceId: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'price_snapshot', type: 'bigint', transformer: bigintToNumber })
  priceSnapshot: number;

  @Column({ name: 'deposit_amount', type: 'bigint', transformer: bigintToNumber })
  depositAmount: number;

  @Column({ type: 'varchar', default: 'pending_payment' })
  status: BookingStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
