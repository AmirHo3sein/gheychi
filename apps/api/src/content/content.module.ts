import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { AdminBlogController } from './admin-blog.controller';
import { BlogCategory } from './blog-category.entity';
import { BlogController } from './blog.controller';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';
import { SitemapBlogController } from './sitemap-blog.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, BlogCategory]), AuthModule, AuditModule, StorageModule],
  controllers: [AdminBlogController, BlogController, SitemapBlogController],
  providers: [ContentService],
})
export class ContentModule {}
