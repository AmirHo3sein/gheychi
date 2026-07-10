import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';

/**
 * Sitemap source for /blog/<slug>, mirroring SitemapSalonsController. Unlike the
 * salons source (bare slugs), each entry carries updatedAt so the user-app's
 * sitemap route can emit lastmod (spec §3.5).
 */
@Controller('sitemap')
export class SitemapBlogController {
  constructor(@InjectRepository(BlogPost) private readonly posts: Repository<BlogPost>) {}

  @Get('blog-posts')
  async list(): Promise<Array<{ slug: string; updatedAt: Date }>> {
    const rows = await this.posts.find({
      where: { status: 'published' },
      select: ['slug', 'updatedAt'],
      order: { publishedAt: 'DESC' },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt }));
  }
}
