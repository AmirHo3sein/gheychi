import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id' })
  actorId: string;

  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ name: 'target_type', type: 'varchar', length: 30 })
  targetType: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column()
  success: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
