import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentSession, type Principal } from '../auth/metadata.js';
import { SellerOperationsService } from './operations.service.js';
import {
  BulkProductDto,
  DraftSaveDto,
  ImageOrderDto,
  OnboardingDto,
} from './operations.dto.js';
const uuid = () => new ParseUUIDPipe({ version: '4' });
@ApiTags('seller product operations')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId', version: '1' })
export class SellerOperationsController {
  constructor(
    @Inject(SellerOperationsService)
    private readonly service: SellerOperationsService,
  ) {}
  @Get('onboarding') onboarding(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
  ) {
    return this.service.onboarding(p, shop);
  }
  @Put('onboarding') progress(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Body() body: OnboardingDto,
  ) {
    return this.service.saveOnboarding(p, shop, body);
  }
  @Get('product-drafts') drafts(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
  ) {
    return this.service.drafts(p, shop);
  }
  @Get('product-drafts/:id') draft(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.service.draft(p, shop, id);
  }
  @Put('product-drafts/:id') save(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('id', uuid()) id: string,
    @Body() body: DraftSaveDto,
  ) {
    return this.service.save(p, shop, id, body);
  }
  @Post('product-drafts/:id/materialize') materialize(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.service.materialize(p, shop, id);
  }
  @Post('products/:id/duplicate') duplicate(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('id', uuid()) id: string,
  ) {
    return this.service.duplicate(p, shop, id);
  }
  @Post('product-actions') bulk(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Body() body: BulkProductDto,
  ) {
    return this.service.bulk(p, shop, body);
  }
  @Put('products/:id/image-order') order(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('id', uuid()) id: string,
    @Body() body: ImageOrderDto,
  ) {
    return this.service.reorder(p, shop, id, body);
  }
}
