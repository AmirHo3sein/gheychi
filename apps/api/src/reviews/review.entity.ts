import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ReviewStatus = 'published' | 'rejected';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'varchar', default: 'published' })
  status: ReviewStatus;

  @Column({ name: 'salon_reply', type: 'text', nullable: true })
  salonReply: string | null;

  @Column({ name: 'salon_reply_at', type: 'timestamptz', nullable: true })
  salonReplyAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
