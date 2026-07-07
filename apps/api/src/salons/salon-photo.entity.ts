import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('salon_photos')
export class SalonPhoto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column()
  url: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_cover', type: 'boolean', default: false })
  isCover: boolean;

  @Column({ name: 'storage_key' })
  storageKey: string;
}
