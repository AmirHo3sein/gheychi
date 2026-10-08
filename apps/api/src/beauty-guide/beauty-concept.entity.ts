import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const BEAUTY_DOMAINS = ['hair_color', 'hair_cut_style', 'nails', 'brows_lashes', 'makeup'] as const;
export type BeautyDomain = (typeof BEAUTY_DOMAINS)[number];

/**
 * One term in Beauty Guide's controlled vocabulary (e.g. `balayage`). The AI may only
 * ever emit a `key` from the ACTIVE set of these rows -- anything else is dropped during
 * validation -- so this table, not the model, defines what Beauty Guide can talk about.
 *
 * `categoryId` is the deterministic bridge to real, bookable services: a concept maps to
 * at most one global service category (the only vocabulary shared across salons, whose
 * service names are free text). NULL = informational only (shown, never matched).
 * `keywords` only BOOST ranking when they appear in a salon's service name/caption; they
 * never filter, because free-text names would silently drop correct matches.
 */
@Entity('beauty_concepts')
export class BeautyConcept {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  key: string;

  @Column({ type: 'varchar', length: 20 })
  domain: BeautyDomain;

  @Column({ name: 'name_fa', type: 'varchar', length: 80 })
  nameFa: string;

  @Column({ name: 'name_en', type: 'varchar', length: 80 })
  nameEn: string;

  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  keywords: string[];

  // Curated, hedged maintenance copy. Preferred over AI-generated maintenance text.
  @Column({ name: 'maintenance_fa', type: 'text', nullable: true })
  maintenanceFa: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
