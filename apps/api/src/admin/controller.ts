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
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Public, CurrentSession, type Principal } from '../auth/metadata.js';
import { requireEmptyBody } from '../auth/dto.js';
import { AdminAuth } from './auth.js';
import { AdminLoginDto, AdminQueryDto, ModerationDecisionDto } from './dto.js';
import {
  AdminArea,
  AdminAccess,
  CurrentAdmin,
  type AdminPrincipal,
} from './metadata.js';
import { AdminLoginThrottle } from './guards.js';
import { adminCookieName, adminCookieOptions } from './security.js';
import { ModerationService } from './moderation.js';
import { AdminEnrollment } from './enrollment.js';
import { AdminPasswordDto, AdminTotpDto } from './enrollment.dto.js';
const uuid = () => new ParseUUIDPipe({ version: '4' });
function writeCookie(
  r: Response,
  config: AppConfig,
  value: { token: string; expiresAt: Date },
) {
  r.cookie(adminCookieName(config), value.token, {
    ...adminCookieOptions(config),
    expires: value.expiresAt,
    maxAge: Math.max(0, value.expiresAt.getTime() - Date.now()),
  });
}
@ApiTags('admin authentication')
@Controller({ path: 'admin/auth', version: '1' })
export class AdminLoginController {
  constructor(
    @Inject(AdminAuth) private readonly auth: AdminAuth,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @Public()
  @UseGuards(AdminLoginThrottle)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: AdminLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.auth.login(body.email, body.password, body.code);
    writeCookie(response, this.config, issued);
    return { expiresAt: issued.expiresAt, csrfToken: issued.csrfToken };
  }
}
@AdminArea()
@ApiTags('admin — mandatory MFA')
@ApiCookieAuth('admin-session')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    @Inject(AdminEnrollment) private readonly enrollment: AdminEnrollment,
    @Inject(AdminAuth) private readonly auth: AdminAuth,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  @AdminAccess('security') @Post('auth/password') password(
    @CurrentAdmin() p: AdminPrincipal,
    @Body() body: AdminPasswordDto,
  ) {
    return this.enrollment.changePassword(p, body);
  }
  @AdminAccess('security') @Post('auth/mfa/setup') setup(
    @CurrentAdmin() p: AdminPrincipal,
    @Body() body: unknown,
  ) {
    requireEmptyBody(body);
    return this.enrollment.setup(p);
  }
  @AdminAccess('security')
  @UseGuards(AdminLoginThrottle)
  @Post('auth/mfa/verify')
  verify(@CurrentAdmin() p: AdminPrincipal, @Body() body: AdminTotpDto) {
    return this.enrollment.verify(p, body.code);
  }
  @AdminAccess('session') @Get('auth/me') me(
    @CurrentAdmin() p: AdminPrincipal,
  ) {
    return this.auth.me(p);
  }
  @AdminAccess('session')
  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentAdmin() p: AdminPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    requireEmptyBody(body);
    await this.auth.logout(p);
    r.clearCookie(
      adminCookieName(this.config),
      adminCookieOptions(this.config),
    );
  }
  @AdminAccess('session')
  @Post('auth/rotate')
  @HttpCode(200)
  async rotate(
    @CurrentAdmin() p: AdminPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) r: Response,
  ) {
    requireEmptyBody(body);
    const issued = await this.auth.rotate(p);
    writeCookie(r, this.config, issued);
    return { expiresAt: issued.expiresAt, csrfToken: issued.csrfToken };
  }
  @AdminAccess('moderation.read') @Get('dashboard') dashboard(
    @CurrentAdmin() p: AdminPrincipal,
  ) {
    return this.moderation.dashboard(p);
  }
  @AdminAccess('moderation.read') @Get('shops') list(
    @CurrentAdmin() p: AdminPrincipal,
    @Query() q: AdminQueryDto,
  ) {
    return this.moderation.list(p, q);
  }
  @AdminAccess('moderation.read') @Get('shops/:shopId') detail(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('shopId', uuid()) id: string,
  ) {
    return this.moderation.detail(p, id);
  }
  // Suspend has a separate permission, checked again transactionally by the service.
  @AdminAccess('moderation.read')
  @Post('shops/:shopId/decisions')
  @HttpCode(200)
  decide(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('shopId', uuid()) id: string,
    @Body() body: ModerationDecisionDto,
    @Req() req: Request,
  ) {
    const requestId = req.res?.getHeader('x-request-id');
    return this.moderation.decide(
      p,
      id,
      body,
      typeof requestId === 'string' ? requestId : undefined,
    );
  }
  @AdminAccess('audit.read') @Get('audit') audit(
    @CurrentAdmin() p: AdminPrincipal,
    @Query() q: AdminQueryDto,
  ) {
    return this.moderation.auditTrail(p, q);
  }
}
@ApiTags('seller verification')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops/:shopId/verification', version: '1' })
export class SellerVerificationController {
  constructor(
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}
  @Post() @HttpCode(200) submit(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) id: string,
    @Body() body: unknown,
  ) {
    requireEmptyBody(body);
    return this.moderation.submit(p, id);
  }
  @Get() history(
    @CurrentSession() p: Principal,
    @Param('shopId', uuid()) id: string,
  ) {
    return this.moderation.sellerHistory(p, id);
  }
}
