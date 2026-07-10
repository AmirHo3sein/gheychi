import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';
import { CreateBlogPostDto, UpdateBlogPostDto } from './dto/blog.dto';

interface QueryBuilderMock {
  leftJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getRawMany: jest.Mock;
}

interface Mocks {
  postsRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  categoriesRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
    delete: jest.Mock;
    find: jest.Mock;
  };
  qb: QueryBuilderMock;
}

// Same shape ReportsService's spec uses: a TypeORM QueryFailedError carrying the pg
// driver's code, which is what isUniqueViolation()/isForeignKeyViolation() read.
function pgError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('db error'), { code });
  return new QueryFailedError('INSERT INTO blog_posts', [], driverError);
}

const draft = (overrides: Partial<BlogPost> = {}): BlogPost =>
  ({
    id: 'post-1',
    title: 'Summer Hair Trends',
    slug: 'summer-hair-trends-ab12',
    excerpt: null,
    bodyMarkdown: '# body',
    coverImageKey: null,
    categoryId: null,
    authorName: null,
    metaDescription: null,
    ogTitle: null,
    status: 'draft',
    publishedAt: null,
    createdAt: new Date('2026-07-01T08:00:00Z'),
    updatedAt: new Date('2026-07-01T08:00:00Z'),
    ...overrides,
  }) as BlogPost;

async function setup(): Promise<{ service: ContentService; mocks: Mocks }> {
  const qb = {} as QueryBuilderMock;
  for (const method of ['leftJoin', 'select', 'addSelect', 'andWhere', 'orderBy', 'offset', 'limit'] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);

  const mocks: Mocks = {
    postsRepo: {
      create: jest.fn((values: Record<string, unknown>) => values),
      save: jest.fn(async (values: Record<string, unknown>) => ({ id: 'post-1', ...values })),
      findOneBy: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    },
    categoriesRepo: {
      create: jest.fn((values: Record<string, unknown>) => values),
      save: jest.fn(async (values: Record<string, unknown>) => ({ id: 1, ...values })),
      findOneBy: jest.fn(),
      delete: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    },
    qb,
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ContentService,
      { provide: getRepositoryToken(BlogPost), useValue: mocks.postsRepo },
      { provide: getRepositoryToken(BlogCategory), useValue: mocks.categoriesRepo },
    ],
  }).compile();

  return { service: moduleRef.get(ContentService), mocks };
}

describe('ContentService.createPost', () => {
  it('creates a draft with an auto-generated slug and null optional fields', async () => {
    const { service, mocks } = await setup();

    const post = await service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith({
      title: 'Summer Hair Trends',
      slug: expect.stringMatching(/^summer-hair-trends-[0-9a-f]{4}$/),
      excerpt: null,
      bodyMarkdown: '# body',
      categoryId: null,
      authorName: null,
      metaDescription: null,
      ogTitle: null,
      status: 'draft',
      publishedAt: null,
    });
    expect(post.id).toBe('post-1');
  });

  it('falls back to a post-prefixed random slug for a Persian title', async () => {
    const { service, mocks } = await setup();

    await service.createPost({ title: 'راهنمای رنگ مو', bodyMarkdown: '# متن' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: expect.stringMatching(/^post-[0-9a-f]{8}$/) }),
    );
  });

  it('carries the optional content/SEO fields through', async () => {
    const { service, mocks } = await setup();

    await service.createPost({
      title: 'Bridal Makeup Guide',
      bodyMarkdown: '## intro',
      excerpt: 'خلاصه مطلب',
      categoryId: 3,
      authorName: 'نگار',
      metaDescription: 'توضیح متا برای گوگل',
      ogTitle: 'عنوان اشتراک‌گذاری',
    });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        excerpt: 'خلاصه مطلب',
        categoryId: 3,
        authorName: 'نگار',
        metaDescription: 'توضیح متا برای گوگل',
        ogTitle: 'عنوان اشتراک‌گذاری',
      }),
    );
  });

  it('translates a slug 23505 into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این نامک قبلاً استفاده شده است',
    });
  });

  it('rethrows non-unique-violation errors untouched', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body' })).rejects.toThrow(
      'connection reset',
    );
  });
});

describe('ContentService.updatePost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.updatePost('missing', { title: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.save).not.toHaveBeenCalled();
  });

  it('applies only the provided fields and preserves the rest', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft({ categoryId: 3, authorName: 'نگار' }));

    await service.updatePost('post-1', { title: 'New Title', bodyMarkdown: '# new' });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'post-1',
        title: 'New Title',
        bodyMarkdown: '# new',
        slug: 'summer-hair-trends-ab12',
        categoryId: 3,
        authorName: 'نگار',
      }),
    );
  });

  it('updates the slug when provided (Persian slugs included)', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());

    await service.updatePost('post-1', { slug: 'رنگ-مو-تابستان' });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ slug: 'رنگ-مو-تابستان' }));
  });

  it('clears nullable fields on explicit null and normalizes empty string to null', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(
      draft({ excerpt: 'old', categoryId: 3, authorName: 'نگار', metaDescription: 'old', ogTitle: 'old' }),
    );

    await service.updatePost('post-1', {
      excerpt: null,
      categoryId: null,
      authorName: '',
      metaDescription: null,
      ogTitle: null,
    });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: null, categoryId: null, authorName: null, metaDescription: null, ogTitle: null }),
    );
  });

  it('translates a slug 23505 on save into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.postsRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.updatePost('post-1', { slug: 'taken-slug' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این نامک قبلاً استفاده شده است',
    });
  });
});

describe('ContentService.getPostForAdmin', () => {
  it('returns the post by id', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());

    await expect(service.getPostForAdmin('post-1')).resolves.toMatchObject({
      id: 'post-1',
      title: 'Summer Hair Trends',
    });
    expect(mocks.postsRepo.findOneBy).toHaveBeenCalledWith({ id: 'post-1' });
  });

  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.getPostForAdmin('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContentService.listPostsForAdmin', () => {
  it("defaults to status 'all' (no status filter) with the standard envelope", async () => {
    const { service, mocks } = await setup();
    mocks.qb.getRawMany.mockResolvedValue([{ id: 'post-1', title: 'Summer Hair Trends', categoryName: 'مو' }]);
    mocks.postsRepo.count.mockResolvedValue(1);

    const result = await service.listPostsForAdmin({});

    expect(result).toEqual({
      items: [{ id: 'post-1', title: 'Summer Hair Trends', categoryName: 'مو' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(mocks.qb.andWhere).not.toHaveBeenCalled();
    expect(mocks.postsRepo.count).toHaveBeenCalledWith({ where: {} });
    expect(mocks.qb.orderBy).toHaveBeenCalledWith('post.createdAt', 'DESC');
    expect(mocks.qb.offset).toHaveBeenCalledWith(0);
    expect(mocks.qb.limit).toHaveBeenCalledWith(20);
  });

  it('applies the status and categoryId filters and paging to both query and count', async () => {
    const { service, mocks } = await setup();

    await service.listPostsForAdmin({ status: 'draft', categoryId: 3, page: 2, pageSize: 10 });

    expect(mocks.qb.andWhere).toHaveBeenCalledWith('post.status = :status', { status: 'draft' });
    expect(mocks.qb.andWhere).toHaveBeenCalledWith('post.categoryId = :categoryId', { categoryId: 3 });
    expect(mocks.postsRepo.count).toHaveBeenCalledWith({ where: { status: 'draft', categoryId: 3 } });
    expect(mocks.qb.offset).toHaveBeenCalledWith(10);
    expect(mocks.qb.limit).toHaveBeenCalledWith(10);
  });
});

describe('blog post DTOs', () => {
  it('CreateBlogPostDto requires title and bodyMarkdown', async () => {
    const errors = await validate(plainToInstance(CreateBlogPostDto, {}));
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['title', 'bodyMarkdown']));
  });

  it('CreateBlogPostDto caps title at 200 and excerpt at 500', async () => {
    const errors = await validate(
      plainToInstance(CreateBlogPostDto, { title: 'x'.repeat(201), bodyMarkdown: '#', excerpt: 'y'.repeat(501) }),
    );
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['title', 'excerpt']));
  });

  it('CreateBlogPostDto accepts a minimal valid payload', async () => {
    await expect(
      validate(plainToInstance(CreateBlogPostDto, { title: 'ترندهای رنگ مو', bodyMarkdown: '# متن' })),
    ).resolves.toEqual([]);
  });

  it('UpdateBlogPostDto accepts a Persian slug and rejects one with whitespace', async () => {
    await expect(validate(plainToInstance(UpdateBlogPostDto, { slug: 'رنگ-مو-تابستان' }))).resolves.toEqual([]);
    const errors = await validate(plainToInstance(UpdateBlogPostDto, { slug: 'has space' }));
    expect(errors.map((e) => e.property)).toContain('slug');
  });

  it('UpdateBlogPostDto caps metaDescription 300 / ogTitle 200 / authorName 80', async () => {
    const errors = await validate(
      plainToInstance(UpdateBlogPostDto, {
        metaDescription: 'x'.repeat(301),
        ogTitle: 'x'.repeat(201),
        authorName: 'x'.repeat(81),
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(expect.arrayContaining(['metaDescription', 'ogTitle', 'authorName']));
  });

  it('UpdateBlogPostDto lets explicit nulls through for clearing nullable fields', async () => {
    await expect(
      validate(plainToInstance(UpdateBlogPostDto, { excerpt: null, categoryId: null, metaDescription: null })),
    ).resolves.toEqual([]);
  });
});
