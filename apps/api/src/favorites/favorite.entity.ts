import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('salon_favorites')
export class Favorite {
  @PrimaryColumn({ name: 'user_id' })
  userId: string;

  @PrimaryColumn({ name: 'salon_id' })
  salonId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
