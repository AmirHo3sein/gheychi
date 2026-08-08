import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('schedule_exceptions')
export class ScheduleException {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'is_closed', default: true })
  isClosed: boolean;

  // NULL (the original, still most-common meaning) = the whole salon is closed on `date`;
  // set = only this one worker is off, salon and every other worker unaffected. See the
  // 1754800000000 migration for the partial-unique-index reasoning.
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  workerId: string | null;

  // Both NULL (the original, still-most-common case) = closed all day. Both set = closed
  // only during [startTime, endTime) on `date` -- the salon's normal working_hours still
  // apply outside that interval. The DB CHECK constraint (see the migration) already
  // forbids one being set without the other, so callers can rely on "both or neither".
  @Column({ name: 'start_time', type: 'time', nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'time', nullable: true })
  endTime: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;
}
