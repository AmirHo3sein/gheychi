import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Named AnalyticsEventRecord (not AnalyticsEvent) to avoid colliding with the
// AnalyticsEvent interface already exported by analytics.provider.ts -- that one is the
// normalized in-flight event AnalyticsService hands to a provider's track(); this one is
// the persisted row PostgresAnalyticsProvider writes and AnalyticsAggregationService reads
// back. See migrations/1754900000000-analytics-events.ts for the table this maps to.
@Entity('analytics_events')
export class AnalyticsEventRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'event_name', type: 'varchar', length: 100 })
  eventName: string;

  @Column({ type: 'jsonb', nullable: true })
  properties: Record<string, unknown> | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
