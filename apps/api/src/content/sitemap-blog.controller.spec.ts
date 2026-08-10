import { Repository } from 'typeorm';
import { BlogPost } from './blog-post.entity';
import { SitemapBlogController } from './sitemap-blog.controller';

describe('SitemapBlogController', () => {
  it('emits only published posts as {slug, updatedAt} on page 1 by default (updatedAt feeds lastmod)', async () => {
    const rows = [{ slug: 'rahnama-rang-mo', updatedAt: new Date('2026-07-09T10:00:00.000Z') }];
    const posts = { findAndCount: jest.fn().mockResolvedValue([rows, 1]) };
    const controller = new SitemapBlogController(posts as unknown as Repository<BlogPost>);

    const result = await controller.list({});

    expect(posts.findAndCount).toHaveBeenCalledWith({
      where: { status: 'published' },
      select: ['slug', 'updatedAt'],
      order: { publishedAt: 'DESC', id: 'ASC' },
      skip: 0,
      take: 5_000,
    });
    expect(result).toEqual({
      items: [{ slug: 'rahnama-rang-mo', updatedAt: new Date('2026-07-09T10:00:00.000Z') }],
      total: 1,
      page: 1,
      pageSize: 5_000,
    });
  });

  it('returns the right slice for an explicit page, computed from the page size', async () => {
    const rows = [{ slug: 'page-two-post', updatedAt: new Date('2026-07-10T00:00:00.000Z') }];
    const posts = { findAndCount: jest.fn().mockResolvedValue([rows, 5_001]) };
    const controller = new SitemapBlogController(posts as unknown as Repository<BlogPost>);

    const result = await controller.list({ page: 2 });

    expect(posts.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 5_000, take: 5_000 }));
    expect(result).toEqual({
      items: [{ slug: 'page-two-post', updatedAt: new Date('2026-07-10T00:00:00.000Z') }],
      total: 5_001,
      page: 2,
      pageSize: 5_000,
    });
  });

  it('returns an empty-but-valid page for a page past the real last page, not an error', async () => {
    const posts = { findAndCount: jest.fn().mockResolvedValue([[], 1]) };
    const controller = new SitemapBlogController(posts as unknown as Repository<BlogPost>);

    const result = await controller.list({ page: 99 });

    expect(posts.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 490_000, take: 5_000 }));
    expect(result).toEqual({ items: [], total: 1, page: 99, pageSize: 5_000 });
  });
});
