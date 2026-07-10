import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { StorageProvider } from '../storage/storage.provider';
import { BlogCategory } from './blog-category.entity';
import { BlogPost } from './blog-post.entity';
import { ContentService } from './content.service';

const draftPost = () => ({
  id: 'post-1',
  title: 'راهنمای رنگ مو',
  slug: 'rahnama-rang-mo',
  excerpt: null,
  bodyMarkdown: '# متن مقاله',
  coverImageKey: null as string | null,
  categoryId: null,
  authorName: null,
  metaDescription: null,
  ogTitle: null,
  status: 'draft' as const,
  publishedAt: null,
  createdAt: new Date('2026-07-01T10:00:00.000Z'),
  updatedAt: new Date('2026-07-01T10:00:00.000Z'),
});

const jpeg = { buffer: Buffer.from('fake-image-bytes'), mimetype: 'image/jpeg' } as Express.Multer.File;

function makeService(overrides?: {
  posts?: Record<string, jest.Mock>;
  storage?: Record<string, jest.Mock>;
}) {
  const posts = {
    findOneBy: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (entity) => entity),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides?.posts,
  };
  const categories = {
    findOneBy: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };
  const storage = {
    upload: jest.fn().mockResolvedValue('http://localhost:3002/uploads/some-key'),
    delete: jest.fn().mockResolvedValue(undefined),
    publicUrl: jest.fn((key: string) => `http://localhost:3002/uploads/${key}`),
    ...overrides?.storage,
  };
  const service = new ContentService(
    posts as unknown as Repository<BlogPost>,
    categories as unknown as Repository<BlogCategory>,
    storage as unknown as StorageProvider,
  );
  return { service, posts, storage };
}

describe('ContentService.setCover', () => {
  it('404s for a missing post without touching storage', async () => {
    const { service, storage } = makeService();

    await expect(service.setCover('missing', jpeg)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('uploads under a server-controlled blog/<postId>/ key and persists it', async () => {
    const { service, posts, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    const result = await service.setCover('post-1', jpeg);

    const key = storage.upload.mock.calls[0][1] as string;
    expect(key).toMatch(/^blog\/post-1\/[0-9a-f-]{36}\.jpg$/);
    expect(storage.upload).toHaveBeenCalledWith(jpeg.buffer, key, 'image/jpeg');
    expect(posts.save).toHaveBeenCalledWith(expect.objectContaining({ coverImageKey: key }));
    expect(result.coverImageUrl).toBe(`http://localhost:3002/uploads/${key}`);
    expect(storage.delete).not.toHaveBeenCalled(); // no previous cover to clean up
  });

  it('derives the extension from the validated mimetype, not the client filename', async () => {
    const { service, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });
    const png = { buffer: Buffer.from('png-bytes'), mimetype: 'image/png' } as Express.Multer.File;

    await service.setCover('post-1', png);

    expect(storage.upload.mock.calls[0][1]).toMatch(/\.png$/);
  });

  it('replacing a cover deletes the old object only after the row is saved', async () => {
    const { service, posts, storage } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
    });

    await service.setCover('post-1', jpeg);

    expect(storage.delete).toHaveBeenCalledWith('blog/post-1/old.jpg');
    // Save-before-delete: a failed cleanup must never lose the new key.
    expect(posts.save.mock.invocationCallOrder[0]).toBeLessThan(storage.delete.mock.invocationCallOrder[0]);
  });

  it('tolerates a failing old-object delete (best-effort cleanup)', async () => {
    const { service } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
      storage: { delete: jest.fn().mockRejectedValue(new Error('storage down')) },
    });

    await expect(service.setCover('post-1', jpeg)).resolves.toMatchObject({
      coverImageKey: expect.stringMatching(/^blog\/post-1\//),
    });
  });
});

describe('ContentService.clearCover', () => {
  it('404s for a missing post', async () => {
    const { service } = makeService();

    await expect(service.clearCover('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears the key, then deletes the object best-effort', async () => {
    const { service, posts, storage } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
    });

    await service.clearCover('post-1');

    expect(posts.save).toHaveBeenCalledWith(expect.objectContaining({ coverImageKey: null }));
    expect(storage.delete).toHaveBeenCalledWith('blog/post-1/old.jpg');
  });

  it('is a no-op when the post has no cover', async () => {
    const { service, posts, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    await service.clearCover('post-1');

    expect(posts.save).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('tolerates a failing object delete', async () => {
    const { service, posts } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/old.jpg' }),
      },
      storage: { delete: jest.fn().mockRejectedValue(new Error('storage down')) },
    });

    await expect(service.clearCover('post-1')).resolves.toBeUndefined();
    expect(posts.save).toHaveBeenCalled();
  });
});

describe('ContentService.getPostForAdmin coverImageUrl', () => {
  it('attaches the derived public URL when a cover key exists (the admin editor consumes this)', async () => {
    const { service } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/cover.jpg' }),
      },
    });

    await expect(service.getPostForAdmin('post-1')).resolves.toMatchObject({
      coverImageUrl: 'http://localhost:3002/uploads/blog/post-1/cover.jpg',
    });
  });

  it('attaches coverImageUrl null when the post has no cover', async () => {
    const { service } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    await expect(service.getPostForAdmin('post-1')).resolves.toMatchObject({ coverImageUrl: null });
  });
});

describe('ContentService.deletePost cover cleanup', () => {
  it('deletes the cover object best-effort after removing the row', async () => {
    const { service, posts, storage } = makeService({
      posts: {
        findOneBy: jest.fn().mockResolvedValue({ ...draftPost(), coverImageKey: 'blog/post-1/cover.jpg' }),
      },
    });

    await service.deletePost('post-1');

    expect(posts.delete).toHaveBeenCalledWith({ id: 'post-1' });
    expect(storage.delete).toHaveBeenCalledWith('blog/post-1/cover.jpg');
  });

  it('skips storage when the post never had a cover', async () => {
    const { service, storage } = makeService({
      posts: { findOneBy: jest.fn().mockResolvedValue(draftPost()) },
    });

    await service.deletePost('post-1');

    expect(storage.delete).not.toHaveBeenCalled();
  });
});
