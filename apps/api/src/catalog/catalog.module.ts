import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { CatalogController } from './catalog.controller';
import { ServiceCategory } from './service-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceCategory]), AuthModule, AuditModule],
  controllers: [CatalogController, AdminCategoriesController],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
