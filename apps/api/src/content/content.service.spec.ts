import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { STORAGE_PROVIDER } from '../storage/storage.provider';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';
import { CreateBlogCategoryDto, CreateBlogPostDto, UpdateBlogCategoryDto, UpdateBlogPostDto } from './dto/blog.dto';

interface QueryBuilderMock {
  leftJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  offset: jest.Mock;
  limit: jest.Mock;
  getRawMany: jest.Mock;
  update: jest.Mock;
  set: jest.Mock;
  where: jest.Mock;
  execute: jest.Mock;
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
  for (const method of [
    'leftJoin',
    'select',
    'addSelect',
    'andWhere',
    'orderBy',
    'offset',
    'limit',
    'update',
    'set',
    'where',
  ] as const) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.execute = jest.fn();

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
      { provide: STORAGE_PROVIDER, useValue: { upload: jest.fn(), delete: jest.fn(), publicUrl: jest.fn() } },
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

  it('transliterates a Persian title into a readable slug instead of an opaque hash', async () => {
    const { service, mocks } = await setup();

    await service.createPost({ title: 'راهنمای رنگ مو', bodyMarkdown: '# متن' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: expect.stringMatching(/^rahnmay-rng-mv-[0-9a-f]{4}$/) }),
    );
  });

  it('still falls back to a post-prefixed random slug when the title has nothing translatable/latin/digit in it', async () => {
    const { service, mocks } = await setup();

    await service.createPost({ title: '!!!', bodyMarkdown: '# متن' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: expect.stringMatching(/^post-[0-9a-f]{8}$/) }),
    );
  });

  it('honors an explicit dto.slug instead of deriving one from the title', async () => {
    const { service, mocks } = await setup();

    await service.createPost({ title: 'راهنمای رنگ مو', bodyMarkdown: '# متن', slug: 'rang-mou-custom' });

    expect(mocks.postsRepo.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'rang-mou-custom' }));
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

  // Deviation (carry-forward from Task 3's review): a nonexistent categoryId used to surface
  // as a raw 500 (23503 fell through the isUniqueViolation-only catch). Now translated to a 400.
  it('translates a nonexistent categoryId (23503) into a Farsi 400', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.save.mockRejectedValue(pgError('23503'));

    await expect(
      service.createPost({ title: 'Summer Hair Trends', bodyMarkdown: '# body', categoryId: 999 }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'دسته‌بندی انتخاب‌شده وجود ندارد',
    });
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

  // Deviation (carry-forward from Task 3's quality review): design §8's accepted risk —
  // updatePost has no status guard, so a slug change on an already-PUBLISHED post is
  // allowed. Previously only inferable from the absence of a check; pinned explicitly here.
  it('allows a slug change on an already-published post (design §8 accepted risk)', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft({ status: 'published', publishedAt: new Date() }));

    await service.updatePost('post-1', { slug: 'new-slug' });

    expect(mocks.postsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ slug: 'new-slug', status: 'published' }));
  });

  // Deviation (carry-forward from Task 3's review): same 23503 gap as createPost.
  it('translates a nonexistent categoryId (23503) on save into a Farsi 400', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.postsRepo.save.mockRejectedValue(pgError('23503'));

    await expect(service.updatePost('post-1', { categoryId: 999 })).rejects.toMatchObject({
      constructor: BadRequestException,
      message: 'دسته‌بندی انتخاب‌شده وجود ندارد',
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

  it('CreateBlogPostDto accepts an optional slug and rejects a malformed one', async () => {
    await expect(
      validate(plainToInstance(CreateBlogPostDto, { title: 'ترندها', bodyMarkdown: '#', slug: 'رنگ-مو-تابستان' })),
    ).resolves.toEqual([]);
    const errors = await validate(
      plainToInstance(CreateBlogPostDto, { title: 'ترندها', bodyMarkdown: '#', slug: 'has space' }),
    );
    expect(errors.map((e) => e.property)).toContain('slug');
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

describe('ContentService.publishPost', () => {
  // The publish stamp is a single atomic UPDATE ... SET published_at = COALESCE(published_at, now())
  // conditioned on status='draft'. COALESCE decides at write time, so there is no stale-read
  // window: whatever happened between the 404-check read and the update, an already-set
  // published_at is never overwritten.
  const setStamp = (mocks: Mocks): { status: string; publishedAt: () => string } =>
    mocks.qb.set.mock.calls[0][0] as { status: string; publishedAt: () => string };

  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.publishPost('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.qb.execute).not.toHaveBeenCalled();
  });

  it('publishes a draft via an atomic COALESCE stamp, conditioned on status=draft', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy
      .mockResolvedValueOnce(draft())
      .mockResolvedValueOnce(draft({ status: 'published', publishedAt: new Date() }));
    mocks.qb.execute.mockResolvedValue({ affected: 1 });

    const result = await service.publishPost('post-1');

    expect(mocks.qb.set).toHaveBeenCalledWith({ status: 'published', publishedAt: expect.any(Function) });
    expect(setStamp(mocks).publishedAt()).toBe('COALESCE(published_at, now())');
    expect(mocks.qb.where).toHaveBeenCalledWith('id = :id AND status = :status', { id: 'post-1', status: 'draft' });
    expect(result.status).toBe('published');
  });

  it('keeps the original published_at on republish — the COALESCE is write-time, immune to stale reads', async () => {
    const { service, mocks } = await setup();
    const original = new Date('2026-06-01T09:00:00Z');
    mocks.postsRepo.findOneBy
      .mockResolvedValueOnce(draft({ publishedAt: original }))
      .mockResolvedValueOnce(draft({ status: 'published', publishedAt: original }));
    mocks.qb.execute.mockResolvedValue({ affected: 1 });

    const result = await service.publishPost('post-1');

    // The SQL-expression form (not a JS Date) is what guarantees the original date survives
    // any interleaving: a non-null published_at wins inside the database, not in a read.
    expect(setStamp(mocks).publishedAt()).toBe('COALESCE(published_at, now())');
    expect(result.publishedAt).toEqual(original);
  });

  it('409s in Farsi when the conditional draft-only update loses a race', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.qb.execute.mockResolvedValue({ affected: 0 });

    await expect(service.publishPost('post-1')).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این مطلب قبلاً منتشر شده است',
    });
  });
});

describe('ContentService.unpublishPost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.unpublishPost('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.update).not.toHaveBeenCalled();
  });

  it('unpublishes via a conditional published-only update and keeps published_at', async () => {
    const { service, mocks } = await setup();
    const original = new Date('2026-06-01T09:00:00Z');
    mocks.postsRepo.findOneBy
      .mockResolvedValueOnce(draft({ status: 'published', publishedAt: original }))
      .mockResolvedValueOnce(draft({ status: 'draft', publishedAt: original }));
    mocks.postsRepo.update.mockResolvedValue({ affected: 1 });

    const result = await service.unpublishPost('post-1');

    // Exact payload: published_at is untouched so a later republish keeps the original date.
    expect(mocks.postsRepo.update).toHaveBeenCalledWith({ id: 'post-1', status: 'published' }, { status: 'draft' });
    expect(result.publishedAt).toEqual(original);
  });

  it('409s in Farsi when the post is not currently published', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft());
    mocks.postsRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.unpublishPost('post-1')).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این مطلب در حال حاضر منتشر نیست',
    });
  });
});

describe('ContentService.deletePost', () => {
  it('404s when the post does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(null);

    await expect(service.deletePost('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.postsRepo.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes the row for any status', async () => {
    const { service, mocks } = await setup();
    mocks.postsRepo.findOneBy.mockResolvedValue(draft({ status: 'published' }));
    mocks.postsRepo.delete.mockResolvedValue({ affected: 1 });

    await service.deletePost('post-1');

    expect(mocks.postsRepo.delete).toHaveBeenCalledWith({ id: 'post-1' });
  });
});

describe('ContentService.createCategory', () => {
  it('auto-generates the slug from the name when none is provided', async () => {
    const { service, mocks } = await setup();

    const category = await service.createCategory({ name: 'Hair Care' });

    expect(mocks.categoriesRepo.create).toHaveBeenCalledWith({
      name: 'Hair Care',
      slug: expect.stringMatching(/^hair-care-[0-9a-f]{4}$/),
    });
    expect(category.id).toBe(1);
  });

  it('pins an explicitly provided slug', async () => {
    const { service, mocks } = await setup();

    await service.createCategory({ name: 'مراقبت از مو', slug: 'مراقبت-مو' });

    expect(mocks.categoriesRepo.create).toHaveBeenCalledWith({ name: 'مراقبت از مو', slug: 'مراقبت-مو' });
  });

  it('translates a duplicate name/slug 23505 into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.createCategory({ name: 'Hair Care' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'دسته‌بندی با این نام یا نامک از قبل وجود دارد',
    });
  });

  it('rethrows non-unique-violation errors untouched', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.save.mockRejectedValue(new Error('connection reset'));

    await expect(service.createCategory({ name: 'Hair Care' })).rejects.toThrow('connection reset');
  });
});

describe('ContentService.updateCategory', () => {
  it('404s when the category does not exist', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue(null);

    await expect(service.updateCategory(9, { name: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.categoriesRepo.save).not.toHaveBeenCalled();
  });

  it('regenerates the slug from the new name when no slug is provided', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue({ id: 1, name: 'Hair Care', slug: 'hair-care-ab12' });

    await service.updateCategory(1, { name: 'Skin Care' });

    expect(mocks.categoriesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Skin Care', slug: expect.stringMatching(/^skin-care-[0-9a-f]{4}$/) }),
    );
  });

  it('keeps a pinned slug over regeneration', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue({ id: 1, name: 'Hair Care', slug: 'hair-care-ab12' });

    await service.updateCategory(1, { name: 'Skin Care', slug: 'skin' });

    expect(mocks.categoriesRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Skin Care', slug: 'skin' }));
  });

  it('translates a duplicate 23505 on save into the Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.findOneBy.mockResolvedValue({ id: 1, name: 'Hair Care', slug: 'hair-care-ab12' });
    mocks.categoriesRepo.save.mockRejectedValue(pgError('23505'));

    await expect(service.updateCategory(1, { name: 'Skin Care' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'دسته‌بندی با این نام یا نامک از قبل وجود دارد',
    });
  });
});

describe('ContentService.deleteCategory', () => {
  it('deletes an unused category', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.delete.mockResolvedValue({ affected: 1 });

    await expect(service.deleteCategory(1)).resolves.toBeUndefined();
    expect(mocks.categoriesRepo.delete).toHaveBeenCalledWith({ id: 1 });
  });

  it('404s when nothing was deleted', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.delete.mockResolvedValue({ affected: 0 });

    await expect(service.deleteCategory(9)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('translates the FK restrict (23503) into the exact Farsi 409', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.delete.mockRejectedValue(pgError('23503'));

    await expect(service.deleteCategory(1)).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این دسته‌بندی دارای مطلب است و قابل حذف نیست',
    });
  });
});

describe('ContentService.listCategories', () => {
  it('lists categories ordered by name', async () => {
    const { service, mocks } = await setup();
    mocks.categoriesRepo.find.mockResolvedValue([{ id: 1, name: 'مو', slug: 'مو' }]);

    await expect(service.listCategories()).resolves.toEqual([{ id: 1, name: 'مو', slug: 'مو' }]);
    expect(mocks.categoriesRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
  });
});

describe('blog category DTOs', () => {
  it('CreateBlogCategoryDto requires a 1–60 char name', async () => {
    expect((await validate(plainToInstance(CreateBlogCategoryDto, {}))).map((e) => e.property)).toContain('name');
    expect(
      (await validate(plainToInstance(CreateBlogCategoryDto, { name: 'x'.repeat(61) }))).map((e) => e.property),
    ).toContain('name');
    await expect(validate(plainToInstance(CreateBlogCategoryDto, { name: 'مراقبت از مو' }))).resolves.toEqual([]);
  });

  it('category slug follows the slug pattern when provided', async () => {
    await expect(validate(plainToInstance(CreateBlogCategoryDto, { name: 'مو', slug: 'مراقبت-مو' }))).resolves.toEqual([]);
    const errors = await validate(plainToInstance(UpdateBlogCategoryDto, { slug: 'has space' }));
    expect(errors.map((e) => e.property)).toContain('slug');
  });
});
