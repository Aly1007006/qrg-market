import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentSession, type Principal } from '../auth/metadata.js';
import { requireEmptyBody } from '../auth/dto.js';
import { SubscriptionService } from './service.js';
class RevisionDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
}
class HistoryQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1;
}
@ApiTags('seller subscriptions — no payment provider')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId/subscription', version: '1' })
export class SubscriptionController {
  constructor(
    @Inject(SubscriptionService) private readonly service: SubscriptionService,
  ) {}
  @Get() read(
    @CurrentSession() p: Principal,
    @Param('shopId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() q: HistoryQuery,
  ) {
    return this.service.read(p, id, q.page);
  }
  @Post() @HttpCode(200) create(
    @CurrentSession() p: Principal,
    @Param('shopId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    requireEmptyBody(body);
    return this.service.create(p, id);
  }
  @Post('renew') @HttpCode(200) renew(
    @CurrentSession() p: Principal,
    @Param('shopId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    requireEmptyBody(body);
    return this.service.requestRenewal(p, id);
  }
  @Post('cancel') @HttpCode(200) cancel(
    @CurrentSession() p: Principal,
    @Param('shopId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RevisionDto,
  ) {
    return this.service.disableRenewal(p, id, body.expectedVersion, true);
  }
  @Post('disable-auto-renew') @HttpCode(200) disable(
    @CurrentSession() p: Principal,
    @Param('shopId', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: RevisionDto,
  ) {
    return this.service.disableRenewal(p, id, body.expectedVersion, false);
  }
}
