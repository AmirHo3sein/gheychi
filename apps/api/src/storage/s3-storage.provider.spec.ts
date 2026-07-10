import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageProvider } from './s3-storage.provider';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn(() => ({ send })),
    PutObjectCommand: jest.fn((input) => ({ input })),
    DeleteObjectCommand: jest.fn((input) => ({ input })),
  };
});

describe('S3StorageProvider', () => {
  const provider = new S3StorageProvider(
    'arayeshgah-photos',
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
        input: expect.objectContaining({ Bucket: 'arayeshgah-photos', Key: 'salons/abc/photo.jpg' }),
      }),
    );
  });

  it('deletes via DeleteObjectCommand', async () => {
    await provider.delete('salons/abc/photo.jpg');
    const clientInstance = (S3Client as unknown as jest.Mock).mock.results[0].value;
    expect(clientInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'arayeshgah-photos', Key: 'salons/abc/photo.jpg' }),
      }),
    );
  });

  it('derives the same public URL from a bare key that upload() returned for it', () => {
    expect(provider.publicUrl('salons/abc/photo.jpg')).toBe('https://cdn.example.com/salons/abc/photo.jpg');
  });
});
