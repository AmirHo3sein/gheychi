import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';
import { SitemapBlogController } from './sitemap-blog.controller';

describe('SitemapBlogController', () => {
  it('emits only published posts as {slug, updatedAt} (updatedAt feeds lastmod)', async () => {
    const rows = [{ slug: 'rahnama-rang-mo', updatedAt: new Date('2026-07-09T10:00:00.000Z') }];
    const posts = { find: jest.fn().mockResolvedValue(rows) };
    const controller = new SitemapBlogController(posts as unknown as Repository<BlogPost>);

    const result = await controller.list();

    expect(posts.find).toHaveBeenCalledWith({
      where: { status: 'published' },
      select: ['slug', 'updatedAt'],
      order: { publishedAt: 'DESC' },
      take: 50_000,
    });
    expect(result).toEqual([{ slug: 'rahnama-rang-mo', updatedAt: new Date('2026-07-09T10:00:00.000Z') }]);
  });
});
