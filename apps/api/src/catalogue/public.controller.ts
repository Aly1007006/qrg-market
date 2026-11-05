import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/metadata.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { clientIdentity } from '../auth/client-identity.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AutocompleteQueryDto, CatalogQueryDto } from './dto.js';
import { PublicCatalogService } from './public.service.js';
@Public()
@ApiTags('Public catalog')
@Controller({ path: 'public', version: '1' })
export class PublicCatalogController {
  constructor(
    @Inject(PublicCatalogService)
    private readonly service: PublicCatalogService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @Get('catalog') catalog(@Query() query: CatalogQueryDto) {
    return this.service.catalog(query);
  }
  @Get('seo/count') seoCount() {
    return this.service.seoCount();
  }
  @Get('seo/entries') seoEntries(@Query() query: CatalogQueryDto) {
    return this.service.seoEntries(query.page);
  }
  @Get('categories') categories() {
    return this.service.categories();
  }
  @Get('brands') brands(@Query() query: CatalogQueryDto) {
    return this.service.brands(query);
  }
  @Get('filters') filters() {
    return this.service.facets();
  }
  @Get('products/:slug') product(@Param('slug') slug: string) {
    return this.service.product(slug);
  }
  @Get('shops') shops(@Query() query: CatalogQueryDto) {
    return this.service.shops(query);
  }
  @Get('shops/:slug') shop(@Param('slug') slug: string) {
    return this.service.shop(slug);
  }
  @Get('shops/:slug/products') async shopProducts(
    @Param('slug') slug: string,
    @Query() query: CatalogQueryDto,
  ) {
    await this.service.shop(slug);
    query.shop = slug;
    return this.service.catalog(query);
  }
  @Get('search/suggestions') async suggestions(
    @Query() query: AutocompleteQueryDto,
    @Req() request: Request,
  ) {
    await this.limiter.consume(
      `search:client:${clientIdentity(request, this.config)}`,
      60,
    );
    return this.service.suggestions(query.q);
  }
}
