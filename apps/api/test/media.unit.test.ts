import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processImage, MAX_IMAGE_BYTES } from '../src/media/processor.js';
import { storageConfig } from '../src/media/storage.js';
void test('JPEG/PNG/WEBP decode, resize and discard EXIF', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const buffer = await sharp({
      create: { width: 2400, height: 100, channels: 3, background: 'red' },
    })
      .withExif({ IFD0: { Artist: 'PRIVATE METADATA' } })
      .toFormat(format)
      .toBuffer();
    const result = await processImage({
      buffer,
      mimetype: 'image/' + format,
      size: buffer.length,
    });
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 2000);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.xmp, undefined);
  }
});
void test('rejects SVG/HTML/executables, MIME spoofing, corruption and oversize', async () => {
  for (const buffer of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('<html><script>alert(1)</script></html>'),
    Buffer.from('MZ executable'),
    Buffer.from([255, 216, 255, 0, 0]),
  ])
    await assert.rejects(
      processImage({ buffer, mimetype: 'image/jpeg', size: buffer.length }),
    );
  const buffer = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    processImage({ buffer, mimetype: 'image/jpeg', size: buffer.length }),
  );
  await assert.rejects(
    processImage({
      buffer: Buffer.alloc(MAX_IMAGE_BYTES + 1),
      mimetype: 'image/png',
      size: MAX_IMAGE_BYTES + 1,
    }),
  );
  const wide = await sharp({
    create: { width: 12001, height: 1, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    processImage({ buffer: wide, mimetype: 'image/png', size: wide.length }),
  );
});
void test('S3 config rejects incomplete, unsafe and production HTTP endpoints', () => {
  assert.equal(storageConfig({}), undefined);
  for (const endpoint of [
    'https://user:pass@storage.test',
    'http://storage.test',
    'file:///tmp',
    'https://storage.test/path',
  ])
    assert.throws(() =>
      storageConfig({ NODE_ENV: 'production', S3_ENDPOINT: endpoint }),
    );
});
