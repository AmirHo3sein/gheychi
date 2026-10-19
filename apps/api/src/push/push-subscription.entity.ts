import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { PushAudience } from './push.provider';

@Entity('push_subscriptions')
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ unique: true })
  endpoint: string;

  @Column()
  p256dh: string;

  @Column()
  auth: string;

  /** Which app's service worker owns this subscription (see migration 1758500000000). */
  @Column({ type: 'varchar', default: 'customer' })
  audience: PushAudience;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
