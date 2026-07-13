import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';

// Google's sitemap protocol caps a single sitemap file at 50,000 URLs. This source is
// unpaginated (fetch-all), so the cap exists purely as a safety ceiling against ever
// emitting an invalid oversized file -- if the platform ever approaches this many
// published posts, replace this with a real sitemap index (multiple files).
const SITEMAP_URL_CAP = 50_000;

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
      take: SITEMAP_URL_CAP,
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt }));
  }
}
