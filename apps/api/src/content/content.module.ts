import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { AdminBlogController } from './admin-blog.controller';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, BlogCategory]), AuthModule, AuditModule, StorageModule],
  controllers: [AdminBlogController],
  providers: [ContentService],
})
export class ContentModule {}
