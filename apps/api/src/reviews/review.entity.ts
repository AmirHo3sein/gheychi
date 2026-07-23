import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// 'withdrawn' is a customer-initiated soft-delete (DELETE /api/reviews/:id, within the
// edit window) -- distinct from an admin 'rejected' moderation call. No DB CHECK
// constraint on this column (reviews.status is plain varchar(20)), so widening this
// enum needed no migration.
export type ReviewStatus = 'published' | 'rejected' | 'withdrawn';

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
