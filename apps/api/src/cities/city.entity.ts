import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// The canonical, DB-backed replacement for the old static IRAN_CITIES array -- every app
// still fetches this via GET /cities, now reading from this table instead of an in-memory
// constant. sort_order preserves the original array's ordering (provincial capitals and
// major centers first), which GET /cities' response order still honors unchanged.
@Entity('cities')
export class City {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  slug: string;

  @Column()
  province: string;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'double precision' })
  lng: number;

  @Column({ name: 'sort_order', type: 'int' })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
