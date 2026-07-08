import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Gender = 'female' | 'male';
export type UserRole = 'customer' | 'provider' | 'admin';
export type UserStatus = 'active' | 'suspended';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phone: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  gender: Gender | null;

  @Column({ type: 'varchar', default: 'customer' })
  role: UserRole;

  @Column({ type: 'varchar', default: 'active' })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
