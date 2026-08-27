import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type CategoryRequestStatus = 'pending' | 'approved' | 'rejected';

@Entity('category_requests')
export class CategoryRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'requester_id' })
  requesterId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: CategoryRequestStatus;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  // Set only on approval -- the real category this request resulted in. ON DELETE SET
  // NULL at the DB level (see the migration), so an admin later deleting the category
  // doesn't resurrect a foreign-key error on this now-inert historical row.
  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
