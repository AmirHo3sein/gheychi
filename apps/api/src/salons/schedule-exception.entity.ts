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
}
