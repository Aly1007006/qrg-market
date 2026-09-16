import {
  Controller,
  Get,
  Post,
  Delete,
  HttpCode,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  ParseEnumPipe,
  SetMetadata,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UnsupportedMediaTypeException,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  type CanActivate,
  type ExecutionContext,
  type NestInterceptor,
  type CallHandler,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { finalize } from 'rxjs';
import {
  CurrentSession,
  IMAGE_UPLOAD_ROUTE,
  Public,
  type Principal,
  type AuthenticatedRequest,
} from '../auth/metadata.js';
import { MediaService } from './service.js';
import {
  IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from './processor.js';
const uuid = () => new ParseUUIDPipe({ version: '4' });
@Injectable()
export class ImageAccessGuard implements CanActivate {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.principal) throw new UnauthorizedException();
    const shop = req.params.shopId;
    const id = req.params.productId;
    if (
      typeof shop !== 'string' ||
      typeof id !== 'string' ||
      ![shop, id].every((v) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          v,
        ),
      )
    )
      throw new BadRequestException();
    await this.media.preflight(req.principal, shop, id);
    return true;
  }
}
@Injectable()
export class ShopImageAccessGuard implements CanActivate {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.principal) throw new UnauthorizedException();
    if (
      typeof req.params.shopId !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(req.params.shopId) ||
      !['logo', 'cover'].includes(String(req.params.kind))
    )
      throw new BadRequestException();
    await this.media.shopPreflight(req.principal, req.params.shopId);
    return true;
  }
}
@Injectable()
export class ImageCapacityInterceptor implements NestInterceptor {
  private active = 0;
  intercept(_context: ExecutionContext, next: CallHandler) {
    if (this.active >= 2)
      throw new HttpException('Upload capacity reached; retry later', 429);
    this.active++;
    return next.handle().pipe(
      finalize(() => {
        this.active--;
      }),
    );
  }
}
@ApiTags('seller shop images')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId/branding/:kind', version: '1' })
export class ShopMediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post('images')
  @SetMetadata(IMAGE_UPLOAD_ROUTE, true)
  @UseGuards(ShopImageAccessGuard)
  @UseInterceptors(
    ImageCapacityInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
      fileFilter: (_req, file, callback) => {
        if (!IMAGE_MIMES.includes(file.mimetype))
          return callback(new UnsupportedMediaTypeException(), false);
        callback(null, true);
      },
    }),
  )
  upload(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('kind', new ParseEnumPipe({ logo: 'logo', cover: 'cover' }))
    kind: 'logo' | 'cover',
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.media.uploadShop(p, shop, kind, file);
  }
  @Get('content') async read(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('kind', new ParseEnumPipe({ logo: 'logo', cover: 'cover' }))
    kind: 'logo' | 'cover',
  ) {
    return new StreamableFile(await this.media.readShop(p, shop, kind), {
      type: 'image/webp',
    });
  }
}
@ApiTags('seller images')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId/products/:productId/images', version: '1' })
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Post()
  @SetMetadata(IMAGE_UPLOAD_ROUTE, true)
  @UseGuards(ImageAccessGuard)
  @UseInterceptors(
    ImageCapacityInterceptor,
    FileInterceptor('file', {
      // Busboy emits partsLimit when the counter reaches its limit, including
      // the final boundary. files/fields enforce exactly one file and zero fields.
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
      fileFilter: (_req, file, callback) => {
        if (!IMAGE_MIMES.includes(file.mimetype))
          return callback(new UnsupportedMediaTypeException(), false);
        callback(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.media.upload(p, shop, id, file);
  }
  @Delete(':imageId')
  @HttpCode(204)
  remove(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
    @Param('imageId', uuid()) image: string,
  ) {
    return this.media.remove(p, shop, id, image);
  }
  @Get(':imageId/content')
  async read(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
    @Param('imageId', uuid()) image: string,
  ) {
    return new StreamableFile(await this.media.read(p, shop, id, image), {
      type: 'image/webp',
    });
  }
}
@Public()
@ApiTags('public images')
@Controller({ path: 'public/images', version: '1' })
export class PublicMediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
  @Get(':imageId') async read(@Param('imageId', uuid()) image: string) {
    return new StreamableFile(await this.media.publicRead(image), {
      type: 'image/webp',
    });
  }
}
