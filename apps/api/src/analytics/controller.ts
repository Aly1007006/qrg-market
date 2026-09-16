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
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public, CurrentSession, type Principal } from '../auth/metadata.js';
import { AuthRateLimiter } from '../auth/rate-limiter.js';
import { AnalyticsService } from './service.js';
import { AnalyticsEventDto, AnalyticsQueryDto } from './dto.js';

@Public()
@ApiTags('internal analytics collection')
@Controller({ path: 'public/analytics', version: '1' })
export class PublicAnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly service: AnalyticsService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  @Post()
  @HttpCode(202)
  async record(@Body() event: AnalyticsEventDto, @Req() request: Request) {
    // Expiring HMAC throttle only, never stored in analytics. No forwarded IP trust.
    await this.limiter.consume(
      `analytics:${request.socket.remoteAddress ?? 'unknown'}:${Math.floor(Date.now() / 900000)}`,
      5000,
    );
    return this.service.record(event);
  }
}
@ApiTags('seller analytics')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId/analytics', version: '1' })
export class SellerAnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly service: AnalyticsService,
  ) {}
  @Get() summary(
    @CurrentSession() principal: Principal,
    @Param('shopId', new ParseUUIDPipe({ version: '4' })) shop: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.service.summary(principal, shop, query.days);
  }
}
