import { NotFound, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { S3StorageProvider } from './s3-storage.provider';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn().mockResolvedValue({});
  class NotFoundMock extends Error {}
  return {
    S3Client: jest.fn(() => ({ send })),
    PutObjectCommand: jest.fn((input) => ({ input })),
    DeleteObjectCommand: jest.fn((input) => ({ input })),
    HeadObjectCommand: jest.fn((input) => ({ input })),
    ListObjectsV2Command: jest.fn((input) => ({ input })),
    NotFound: NotFoundMock,
  };
});

jest.mock('@smithy/node-http-handler', () => ({
  NodeHttpHandler: jest.fn(() => ({ __mockHandler: true })),
}));

describe('S3StorageProvider', () => {
  const provider = new S3StorageProvider(
    'gheychi-photos',
    'https://cdn.example.com',
    'https://s3.example.com',
    'us-east-1',
    'access-key',
    'secret-key',
  );

  it('uploads via PutObjectCommand and returns a public URL built from the bucket key', async () => {
    const url = await provider.upload(Buffer.from('bytes'), 'salons/abc/photo.jpg', 'image/jpeg');
    expect(url).toBe('https://cdn.example.com/salons/abc/photo.jpg');

    const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
    expect(clientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'gheychi-photos', Key: 'salons/abc/photo.jpg' }),
      }),
    );
  });

  it('deletes via DeleteObjectCommand', async () => {
    await provider.delete('salons/abc/photo.jpg');
    const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
    expect(clientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'gheychi-photos', Key: 'salons/abc/photo.jpg' }),
      }),
    );
  });

  it('derives the same public URL from a bare key that upload() returned for it', () => {
    expect(provider.publicUrl('salons/abc/photo.jpg')).toBe('https://cdn.example.com/salons/abc/photo.jpg');
  });

  it('bounds every S3 request with connection and request timeouts', () => {
    expect(NodeHttpHandler).toHaveBeenCalledWith({ connectionTimeout: 5_000, requestTimeout: 10_000 });
    const handlerInstance = (NodeHttpHandler as unknown as jest.Mock).mock.results[0].value;
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ requestHandler: handlerInstance }),
    );
  });

  describe('exists', () => {
    it('is true when HeadObjectCommand succeeds', async () => {
      const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
      clientInstance.send.mockResolvedValueOnce({});

      await expect(provider.exists('salons/abc/photo.jpg')).resolves.toBe(true);
    });

    it('is false when HeadObjectCommand rejects with NotFound, and does not swallow other errors', async () => {
      const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
      clientInstance.send.mockRejectedValueOnce(new NotFound({ message: 'not found', $metadata: {} }));
      await expect(provider.exists('salons/missing.jpg')).resolves.toBe(false);

      clientInstance.send.mockRejectedValueOnce(new Error('network blip'));
      await expect(provider.exists('salons/abc/photo.jpg')).rejects.toThrow('network blip');
    });
  });

  describe('list', () => {
    it('maps a single, non-truncated page of Contents to {key, lastModified}', async () => {
      const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
      const lastModified = new Date('2026-01-01T00:00:00.000Z');
      clientInstance.send.mockResolvedValueOnce({
        Contents: [{ Key: 'salons/a/photo.jpg', LastModified: lastModified }],
        IsTruncated: false,
      });

      const results = await provider.list('salons/');

      expect(results).toEqual([{ key: 'salons/a/photo.jpg', lastModified }]);
      expect(clientInstance.send).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ Bucket: 'gheychi-photos', Prefix: 'salons/' }) }),
      );
    });

    it('follows ContinuationToken across pages until IsTruncated is false', async () => {
      const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
      clientInstance.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'salons/a/1.jpg', LastModified: new Date() }],
          IsTruncated: true,
          NextContinuationToken: 'token-2',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'salons/a/2.jpg', LastModified: new Date() }],
          IsTruncated: false,
        });

      const results = await provider.list('salons/');

      expect(results.map((r) => r.key)).toEqual(['salons/a/1.jpg', 'salons/a/2.jpg']);
      expect(clientInstance.send).toHaveBeenCalledWith(
        expect.objectContaining({ input: expect.objectContaining({ ContinuationToken: 'token-2' }) }),
      );
    });

    it('returns an empty array when the prefix has no objects', async () => {
      const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
      clientInstance.send.mockResolvedValueOnce({ Contents: undefined, IsTruncated: false });

      await expect(provider.list('salons/')).resolves.toEqual([]);
    });
  });
});
