import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('platform_config')
export class PlatformConfig {
  @PrimaryColumn()
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;
}
