import {
  Injectable,
  ServiceUnavailableException,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export abstract class ObjectStorage {
  abstract put(key: string, bytes: Buffer): Promise<void>;
  abstract read(key: string): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;
}

export function storageConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.S3_ENDPOINT) {
    if (
      [
        env.S3_BUCKET,
        env.S3_REGION,
        env.S3_ACCESS_KEY_ID,
        env.S3_SECRET_ACCESS_KEY,
      ].some(Boolean)
    )
      throw new Error('S3 configuration incomplete');
    return undefined;
  }
  const endpoint = new URL(env.S3_ENDPOINT);
  if (
    env.NODE_ENV === 'production' &&
    (env.S3_ACCESS_KEY_ID === 'qrg-local-only' ||
      env.S3_SECRET_ACCESS_KEY === 'local-storage-only-change-me')
  )
    throw new Error(
      'Production storage credentials must be explicitly configured',
    );
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash ||
    (env.NODE_ENV === 'production' && endpoint.protocol !== 'https:')
  )
    throw new Error('Invalid S3 endpoint');
  if (
    !env.S3_BUCKET ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET) ||
    !env.S3_REGION ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY
  )
    throw new Error('S3 configuration incomplete');
  if (
    env.S3_FORCE_PATH_STYLE &&
    !['true', 'false'].includes(env.S3_FORCE_PATH_STYLE)
  )
    throw new Error('Invalid S3_FORCE_PATH_STYLE');
  return {
    endpoint: endpoint.origin,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}

@Injectable()
export class S3ObjectStorage
  extends ObjectStorage
  implements OnApplicationShutdown
{
  private readonly config = storageConfig();
  private readonly client = this.config
    ? new S3Client({ ...this.config, maxAttempts: 2 })
    : undefined;
  private ready(key: string) {
    if (
      !/^(products|shops)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|avif)$/.test(key)
    )
      throw new Error('Unsafe object key');
    if (!this.client || !this.config)
      throw new ServiceUnavailableException('Object storage is not configured');
    return { client: this.client, Bucket: this.config.bucket, Key: key };
  }
  async put(key: string, bytes: Buffer) {
    const { client, ...target } = this.ready(key);
    await client.send(
      new PutObjectCommand({
        ...target,
        Body: bytes,
        ContentType: 'image/webp',
        CacheControl: 'private, no-store',
      }),
      { abortSignal: AbortSignal.timeout(20000) },
    );
  }
  async read(key: string) {
    const { client, ...target } = this.ready(key);
    const response = await client.send(new GetObjectCommand(target), {
      abortSignal: AbortSignal.timeout(20000),
    });
    if (
      !response.Body ||
      !response.ContentLength ||
      response.ContentLength > 10 * 1024 * 1024
    )
      throw new ServiceUnavailableException();
    return Buffer.from(await response.Body.transformToByteArray());
  }
  async remove(key: string) {
    const { client, ...target } = this.ready(key);
    await client.send(new DeleteObjectCommand(target), {
      abortSignal: AbortSignal.timeout(20000),
    });
  }
  onApplicationShutdown() {
    this.client?.destroy();
  }
}
