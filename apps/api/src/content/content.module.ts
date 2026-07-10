import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

@Module({
  imports: [TypeOrmModule.forFeature([BlogPost, BlogCategory])],
  providers: [ContentService],
})
export class ContentModule {}
