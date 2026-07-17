import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type StoryStatus = 'published' | 'removed';

@Entity('salon_stories')
export class SalonStory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column()
  url: string;

  @Column({ name: 'storage_key' })
  storageKey: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  caption: string | null;

  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  @Column({ type: 'varchar', default: 'published' })
  status: StoryStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Stamped at INSERT by the DB clock (now() + interval '24 hours') -- the same clock
  // every read filter compares against, so expiry can't drift with the app clock.
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
