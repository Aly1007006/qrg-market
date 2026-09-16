import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/metadata.js';
import { AutocompleteQueryDto, CatalogQueryDto } from './dto.js';
import { PublicCatalogService } from './public.service.js';
@Public()
@ApiTags('Public catalog')
@Controller({ path: 'public', version: '1' })
export class PublicCatalogController {
  constructor(
    @Inject(PublicCatalogService)
    private readonly service: PublicCatalogService,
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
  @Get('search/suggestions') suggestions(@Query() query: AutocompleteQueryDto) {
    return this.service.suggestions(query.q);
  }
}
