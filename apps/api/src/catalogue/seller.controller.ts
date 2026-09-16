import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentSession, type Principal } from '../auth/metadata.js';
import {
  ProductCreateDto,
  ProductFieldsDto,
  VariantDto,
  LocationDto,
  ContactsDto,
} from './dto.js';
import { SellerCatalogService } from './seller.service.js';
import { ProductListQueryDto } from './operations.dto.js';
const uuid = () => new ParseUUIDPipe({ version: '4' });
@ApiTags('private seller catalogue')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId', version: '1' })
export class SellerCatalogController {
  constructor(
    @Inject(SellerCatalogService)
    private readonly service: SellerCatalogService,
  ) {}
  @Post('products') create(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Body() b: ProductCreateDto,
  ) {
    return this.service.create(p, shop, b);
  }
  @Get('products') list(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Query() q: ProductListQueryDto,
  ) {
    return this.service.list(p, shop, q);
  }
  @Get('products/:productId') get(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
  ) {
    return this.service.get(p, shop, id);
  }
  @Put('products/:productId') update(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
    @Body() b: ProductFieldsDto,
  ) {
    return this.service.update(p, shop, id, b);
  }
  @Post('products/:productId/variants') variant(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
    @Body() b: VariantDto,
  ) {
    return this.service.addVariant(p, shop, id, b);
  }
  @Put('products/:productId/variants/:variantId') updateVariant(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('productId', uuid()) id: string,
    @Param('variantId', uuid()) variant: string,
    @Body() b: VariantDto,
  ) {
    return this.service.updateVariant(p, shop, id, variant, b);
  }
  @Put('location') location(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Body() b: LocationDto,
  ) {
    return this.service.location(p, shop, b);
  }
  @Get('profile') profile(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
  ) {
    return this.service.profile(p, shop);
  }
  @Put('contacts') contacts(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Body() b: ContactsDto,
  ) {
    return this.service.contacts(p, shop, b);
  }
}
