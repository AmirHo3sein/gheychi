import { Column, Entity, PrimaryColumn } from 'typeorm';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * One concept on one guide. The customer's corrections are recorded HERE and are
 * authoritative from then on: removing flips `removed` (the AI's original row is kept for
 * auditability, never re-applied), adding inserts a `source='user'` row with confidence
 * 'high'. The effective concept set is always `removed = false`.
 */
@Entity('beauty_guide_concepts')
export class BeautyGuideConcept {
  @PrimaryColumn({ name: 'guide_id', type: 'uuid' })
  guideId: string;

  @PrimaryColumn({ name: 'concept_id', type: 'uuid' })
  conceptId: string;

  @Column({ type: 'varchar', length: 10 })
  confidence: ConfidenceLevel;

  @Column({ type: 'varchar', length: 10 })
  source: 'ai' | 'user';

  @Column({ default: false })
  removed: boolean;

  @Column({ name: 'evidence_fa', type: 'varchar', length: 300, nullable: true })
  evidenceFa: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
