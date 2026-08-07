import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// A worker with NO rows here is unrestricted -- eligible for every one of the salon's
// services (see the migration comment for why that's the deliberate default). A row
// existing means the owner has explicitly opted this worker into a restricted set.
@Entity('worker_services')
export class WorkerService {
  @PrimaryColumn({ name: 'worker_id' })
  workerId: string;

  @PrimaryColumn({ name: 'service_id' })
  serviceId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
