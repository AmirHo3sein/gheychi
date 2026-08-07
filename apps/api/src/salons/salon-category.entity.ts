import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Deliberate tag, not a derived value: earlier this only existed implicitly (a salon
// "matched" a category if it happened to have an active service in it, via an EXISTS
// subquery -- see search.service.ts's history). A salon can be tagged into more than
// one category, chosen by its owner, independent of which services it currently lists.
@Entity('salon_categories')
export class SalonCategory {
  @PrimaryColumn({ name: 'salon_id' })
  salonId: string;

  @PrimaryColumn({ name: 'category_id', type: 'int' })
  categoryId: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
