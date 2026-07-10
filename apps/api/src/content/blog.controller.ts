import { Controller, Get, Param, Query } from '@nestjs/common';
import { ContentService } from './content.service';
import { PublicBlogPostsQueryDto } from './dto/blog.dto';

/** Public, unauthenticated blog surface (spec §3.4) -- published content only. */
@Controller('blog')
export class BlogController {
  constructor(private readonly content: ContentService) {}

  @Get('posts')
  list(@Query() query: PublicBlogPostsQueryDto) {
    return this.content.listPublishedPosts(query);
  }

  @Get('posts/:slug')
  bySlug(@Param('slug') slug: string) {
    return this.content.getPublishedBySlug(slug);
  }

  @Get('categories')
  categories() {
    return this.content.listCategories();
  }
}
