import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Never retain source bytes, EXIF, filenames or caller-supplied object keys. */
export async function processImage(file: UploadedImage | undefined) {
  if (!file?.buffer.length) throw new BadRequestException('Image required');
  if (file.buffer.length > MAX_IMAGE_BYTES)
    throw new PayloadTooLargeException();
  if (!IMAGE_MIMES.includes(file.mimetype))
    throw new UnsupportedMediaTypeException();
  const b = file.buffer;
  const detected = b
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? 'png'
    : b[0] === 255 && b[1] === 216 && b[2] === 255
      ? 'jpeg'
      : b.toString('ascii', 0, 4) === 'RIFF' &&
          b.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : '';
  if (!detected || file.mimetype !== `image/${detected}`)
    throw new UnsupportedMediaTypeException();
  try {
    const pipeline = sharp(b, {
      failOn: 'warning',
      limitInputPixels: 40_000_000,
    });
    const metadata = await pipeline.metadata();
    if (
      metadata.format !== detected ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 12000 ||
      metadata.height > 12000 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error('Invalid image');
    const result = await pipeline
      .rotate()
      .resize({
        width: 2000,
        height: 2000,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .timeout({ seconds: 15 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_IMAGE_BYTES)
      throw new Error('Output too large');
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new BadRequestException(
      'Invalid or unsupported image dimensions/data',
    );
  }
}
