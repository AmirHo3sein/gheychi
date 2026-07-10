import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Injectable } from '@nestjs/common';
import { StorageProvider } from './storage.provider';

const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
    endpoint: string,
    region: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
        requestTimeout: S3_REQUEST_TIMEOUT_MS,
      }),
    });
  }

  async upload(buffer: Buffer, key: string, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType }),
    );
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
