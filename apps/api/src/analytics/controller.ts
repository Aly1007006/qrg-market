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
import { APP_CONFIG, type AppConfig } from '../config.js';
import { clientIdentity } from '../auth/client-identity.js';

@Public()
@ApiTags('internal analytics collection')
@Controller({ path: 'public/analytics', version: '1' })
export class PublicAnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly service: AnalyticsService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @Post()
  @HttpCode(202)
  async record(@Body() event: AnalyticsEventDto, @Req() request: Request) {
    // Expiring HMAC throttle only, never stored in analytics. No forwarded IP trust.
    const identity = clientIdentity(request, this.config);
    await this.limiter.consume(`analytics:${identity}`, 120);
    await this.limiter.consume(
      `analytics:${identity}:${event.type}:${event.resource}:${event.slug}`,
      event.type.endsWith('_CLICK') ? 10 : 20,
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
