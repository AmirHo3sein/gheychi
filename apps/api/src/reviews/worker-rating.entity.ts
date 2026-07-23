import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// No 'withdrawn' state here (unlike Review) -- the worker_ratings.status CHECK
// constraint only allows published/rejected (see the Slice 1 migration). A withdrawn
// parent Review cascades by flipping its linked WorkerRating to 'rejected', which
// already excludes it from recomputeWorkerRating's aggregate the same way an admin
// rejection would -- reusing the existing allowed value rather than widening the
// CHECK constraint for a state that's only ever reached via the parent Review.
export type WorkerRatingStatus = 'published' | 'rejected';

@Entity('worker_ratings')
export class WorkerRating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'review_id' })
  reviewId: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @Column({ name: 'worker_id' })
  workerId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'int' })
  rating: number;

  @Column({ type: 'varchar', default: 'published' })
  status: WorkerRatingStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
