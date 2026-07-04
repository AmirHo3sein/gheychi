import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('working_hours')
export class WorkingHour {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ type: 'smallint' })
  weekday: number;

  @Column({ name: 'open_time', type: 'time' })
  openTime: string;

  @Column({ name: 'close_time', type: 'time' })
  closeTime: string;
}
