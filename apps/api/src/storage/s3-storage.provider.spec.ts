import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { S3StorageProvider } from './s3-storage.provider';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn(() => ({ send })),
    PutObjectCommand: jest.fn((input) => ({ input })),
    DeleteObjectCommand: jest.fn((input) => ({ input })),
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
});
