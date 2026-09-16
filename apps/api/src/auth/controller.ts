import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AuthService } from './service.js';
import { PasswordResetService } from './password-reset.js';
import {
  AuthThrottle,
  CurrentSession,
  Public,
  type Principal,
} from './metadata.js';
import {
  EmailDto,
  LoginDto,
  requireEmptyBody,
  ResetConfirmDto,
  SignupDto,
} from './dto.js';
import {
  clearSessionCookie,
  readSessionToken,
  writeSessionCookie,
} from './tokens.js';

@ApiTags('seller authentication')
@ApiCookieAuth('seller-session')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PasswordResetService) private readonly reset: PasswordResetService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @AuthThrottle('signup')
  @Post('signup')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Register seller; same response for existing email, no automatic session',
  })
  @ApiResponse({ status: 202 })
  async signup(@Body() body: SignupDto) {
    await this.auth.signup(body.email, body.password);
    return {
      message:
        'Registration request processed. You may sign in with your credentials.',
    };
  }

  @Public()
  @AuthThrottle('login')
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.auth.login(
      body.email,
      body.password,
      readSessionToken(request, this.config),
    );
    writeSessionCookie(response, this.config, issued.token, issued.expiresAt);
    return {
      user: issued.user,
      sessionId: issued.sessionId,
      expiresAt: issued.expiresAt,
      csrfToken: issued.csrfToken,
    };
  }

  @Get('me') me(@CurrentSession() principal: Principal) {
    return this.auth.me(principal);
  }
  @Get('sessions') sessions(@CurrentSession() principal: Principal) {
    return this.auth.listSessions(principal);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentSession() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireEmptyBody(body);
    await this.auth.revoke(principal, principal.sessionId);
    clearSessionCookie(response, this.config);
  }

  @Post('sessions/revoke-all')
  @HttpCode(204)
  async revokeAll(
    @CurrentSession() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireEmptyBody(body);
    await this.auth.revokeAll(principal);
    clearSessionCookie(response, this.config);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revoke(
    @CurrentSession() principal: Principal,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireEmptyBody(body);
    await this.auth.revoke(principal, sessionId);
    if (sessionId === principal.sessionId)
      clearSessionCookie(response, this.config);
  }

  @Post('session/rotate')
  @HttpCode(200)
  async rotate(
    @CurrentSession() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    requireEmptyBody(body);
    const issued = await this.auth.rotate(principal);
    writeSessionCookie(response, this.config, issued.token, issued.expiresAt);
    return { expiresAt: issued.expiresAt, csrfToken: issued.csrfToken };
  }

  @Public()
  @AuthThrottle('reset-request')
  @Post('password-reset/request')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Request reset; 503 until a real email delivery adapter is configured',
  })
  @ApiResponse({ status: 503, description: 'Delivery adapter unavailable' })
  async requestReset(@Body() body: EmailDto) {
    await this.reset.request(body.email);
    return {
      message:
        'If the account is eligible, password reset instructions will be sent.',
    };
  }

  @Public()
  @AuthThrottle('reset-confirm')
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmReset(
    @Body() body: ResetConfirmDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.reset.confirm(body.token, body.password);
    clearSessionCookie(response, this.config);
  }
}
