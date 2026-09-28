import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// A salon-private counterpart to the global, admin-owned ServiceCategory: created and
// usable immediately by the owner, no admin approval round-trip (unlike CategoryRequest,
// which exists specifically to grow the GLOBAL list). Deliberately never joined into
// SalonCategory (the search-tag table) or the public /categories list -- a custom category
// must never become a marketplace-wide filter.
@Entity('salon_custom_categories')
export class SalonCustomCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column()
  name: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
