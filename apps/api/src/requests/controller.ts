import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentSession, Public, type Principal } from '../auth/metadata.js';
import { CustomerRequestsService } from './service.js';
import { CreateRequestDto, RequestQueryDto, RequestStatusDto } from './dto.js';
import { RequestSpamGuard } from './spam.js';
const uuid = () => new ParseUUIDPipe({ version: '4' });
@Public()
@ApiTags('guest customer requests — no payments')
@UseGuards(RequestSpamGuard)
@Controller({ path: 'public/requests', version: '1' })
export class PublicRequestsController {
  constructor(
    @Inject(CustomerRequestsService)
    private readonly service: CustomerRequestsService,
  ) {}
  @Get('challenge/:productId') challenge(
    @Param('productId', uuid()) id: string,
  ) {
    return this.service.challenge(id);
  }
  @Post() @HttpCode(202) create(@Body() body: CreateRequestDto) {
    return this.service.create(body);
  }
}
@ApiTags('seller customer requests')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId/requests', version: '1' })
export class SellerRequestsController {
  constructor(
    @Inject(CustomerRequestsService)
    private readonly service: CustomerRequestsService,
  ) {}
  @Get() list(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Query() q: RequestQueryDto,
  ) {
    return this.service.list(p, shop, q);
  }
  @Get(':requestId') get(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('requestId', uuid()) id: string,
  ) {
    return this.service.get(p, shop, id);
  }
  @Patch(':requestId') update(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) shop: string,
    @Param('requestId', uuid()) id: string,
    @Body() body: RequestStatusDto,
  ) {
    return this.service.update(p, shop, id, body);
  }
}
