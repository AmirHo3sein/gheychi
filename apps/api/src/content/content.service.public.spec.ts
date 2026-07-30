import { NotFoundException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { StorageProvider } from '../storage/storage.provider';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

const publishedPost = () => ({
  id: 'post-1',
  title: 'راهنمای رنگ مو',
  slug: 'rahnama-rang-mo',
  excerpt: 'خلاصه مقاله',
  bodyMarkdown: '# متن کامل مقاله',
  coverImageKey: 'blog/post-1/cover.jpg' as string | null,
  categoryId: 7 as number | null,
  authorName: 'تیم قیچی',
  metaDescription: 'توضیح متا',
  ogTitle: 'عنوان اشتراک‌گذاری',
  status: 'published' as const,
  publishedAt: new Date('2026-07-09T10:00:00.000Z'),
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-07-09T10:00:00.000Z'),
});

function makeService(overrides?: {
  posts?: Record<string, jest.Mock>;
  categories?: Record<string, jest.Mock>;
}) {
  const posts = {
    findOneBy: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    ...overrides?.posts,
  };
  const categories = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    ...overrides?.categories,
  };
  const storage = {
    upload: jest.fn(),
    delete: jest.fn(),
    publicUrl: jest.fn((key: string) => `http://localhost:3002/uploads/${key}`),
  };
  const service = new ContentService(
    posts as unknown as Repository<BlogPost>,
    categories as unknown as Repository<BlogCategory>,
    storage as unknown as StorageProvider,
  );
  return { service, posts, categories };
}

describe('ContentService.listPublishedPosts', () => {
  it('queries published-only, newest published first, with default paging', async () => {
    const { service, posts } = makeService();

    const result = await service.listPublishedPosts({});

    expect(posts.findAndCount).toHaveBeenCalledWith({
      where: { status: 'published' },
      order: { publishedAt: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('maps items to the public shape: derived coverImageUrl, joined category, no bodyMarkdown', async () => {
    const { service, categories } = makeService({
      posts: { findAndCount: jest.fn().mockResolvedValue([[publishedPost()], 1]) },
      categories: { find: jest.fn().mockResolvedValue([{ id: 7, name: 'رنگ مو', slug: 'rang-mo' }]) },
    });

    const result = await service.listPublishedPosts({});

    expect(categories.find).toHaveBeenCalledWith({ where: { id: In([7]) } });
    expect(result.items[0]).toEqual({
      id: 'post-1',
      title: 'راهنمای رنگ مو',
      slug: 'rahnama-rang-mo',
      excerpt: 'خلاصه مقاله',
      coverImageUrl: 'http://localhost:3002/uploads/blog/post-1/cover.jpg',
      categoryName: 'رنگ مو',
      categorySlug: 'rang-mo',
      authorName: 'تیم قیچی',
      publishedAt: new Date('2026-07-09T10:00:00.000Z'),
    });
    expect(result.items[0]).not.toHaveProperty('bodyMarkdown');
  });

  it('returns null cover/category fields for posts without them, skipping the category lookup', async () => {
    const { service, categories } = makeService({
      posts: {
        findAndCount: jest
          .fn()
          .mockResolvedValue([[{ ...publishedPost(), coverImageKey: null, categoryId: null }], 1]),
      },
    });

    const result = await service.listPublishedPosts({});

    expect(categories.find).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ coverImageUrl: null, categoryName: null, categorySlug: null });
  });

  it('resolves a category slug filter to its id and applies explicit paging', async () => {
    const { service, posts, categories } = makeService({
      categories: { findOneBy: jest.fn().mockResolvedValue({ id: 7, name: 'رنگ مو', slug: 'rang-mo' }) },
    });

    await service.listPublishedPosts({ category: 'rang-mo', page: 2, pageSize: 10 });

    expect(categories.findOneBy).toHaveBeenCalledWith({ slug: 'rang-mo' });
    expect(posts.findAndCount).toHaveBeenCalledWith({
      where: { status: 'published', categoryId: 7 },
      order: { publishedAt: 'DESC' },
      skip: 10,
      take: 10,
    });
  });

  it('short-circuits an unknown category slug to an empty envelope', async () => {
    const { service, posts } = makeService();

    const result = await service.listPublishedPosts({ category: 'na-mojood' });

    expect(posts.findAndCount).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });
});

describe('ContentService.getPublishedBySlug', () => {
  it('looks up by slug AND published status, returning the full post with derived fields', async () => {
    const { service, posts } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(publishedPost()) },
      categories: { findOneBy: jest.fn().mockResolvedValue({ id: 7, name: 'رنگ مو', slug: 'rang-mo' }) },
    });

    const result = await service.getPublishedBySlug('rahnama-rang-mo');

    expect(posts.findOneBy).toHaveBeenCalledWith({ slug: 'rahnama-rang-mo', status: 'published' });
    expect(result).toMatchObject({
      bodyMarkdown: '# متن کامل مقاله',
      metaDescription: 'توضیح متا',
      ogTitle: 'عنوان اشتراک‌گذاری',
      coverImageUrl: 'http://localhost:3002/uploads/blog/post-1/cover.jpg',
      categoryName: 'رنگ مو',
      categorySlug: 'rang-mo',
    });
  });

  it('404s for missing and draft slugs alike (status is part of the lookup key)', async () => {
    const { service } = makeService();

    await expect(service.getPublishedBySlug('pish-nevis')).rejects.toBeInstanceOf(NotFoundException);
  });
});
