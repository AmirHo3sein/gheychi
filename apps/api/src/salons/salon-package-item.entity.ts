import { Column, Entity, PrimaryColumn } from 'typeorm';

// An ordered, deduplicated member of a SalonPackage -- one of the salon's own existing
// services. service_id is deliberately not cascade-deleted (matches worker_services'/
// salon_services.category_id's own restrict precedent): a service still listed in a package
// cannot be hard-deleted out from under it.
@Entity('salon_package_items')
export class SalonPackageItem {
  @PrimaryColumn({ name: 'package_id' })
  packageId: string;

  @PrimaryColumn({ name: 'service_id' })
  serviceId: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
