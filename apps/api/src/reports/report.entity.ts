import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

// Discriminator for what kind of content the report targets. Unlike the target FK
// columns (nulled by ON DELETE SET NULL when a provider deletes the reported
// story/portfolio item), this survives the delete — it is the only way to tell an
// orphaned content report apart from a salon report. Set server-side from the
// resolved target in ReportsService.create(); never client-supplied.
export type ReportTargetType = 'salon' | 'review' | 'story' | 'portfolio';

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reporter_id' })
  reporterId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'review_id', type: 'uuid', nullable: true })
  reviewId: string | null;

  @Column({ name: 'story_id', type: 'uuid', nullable: true })
  storyId: string | null;

  @Column({ name: 'portfolio_item_id', type: 'uuid', nullable: true })
  portfolioItemId: string | null;

  @Column({ name: 'target_type', type: 'varchar' })
  targetType: ReportTargetType;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'varchar', default: 'open' })
  status: ReportStatus;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
