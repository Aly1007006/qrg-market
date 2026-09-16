import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import {
  AdminArea,
  AdminAccess,
  CurrentAdmin,
  type AdminPrincipal,
} from './metadata.js';
import { AdminControl } from './control.js';
import {
  AdminActionDto,
  AdminCreateDto,
  ControlQueryDto,
  ProductModerationDto,
  UserActionDto,
} from './control.dto.js';
const uuid = () => new ParseUUIDPipe({ version: '4' });
function requestId(req: Request) {
  const value = req.res?.getHeader('x-request-id');
  return typeof value === 'string' ? value : randomUUID();
}
@AdminArea()
@ApiTags('admin control center')
@ApiCookieAuth('admin-session')
@Controller({ path: 'admin', version: '1' })
export class AdminControlController {
  constructor(@Inject(AdminControl) private readonly service: AdminControl) {}
  @AdminAccess('overview.read') @Get('overview') overview(
    @CurrentAdmin() p: AdminPrincipal,
  ) {
    return this.service.overview(p);
  }
  @AdminAccess('users.read') @Get('users') users(
    @CurrentAdmin() p: AdminPrincipal,
    @Query() q: ControlQueryDto,
  ) {
    return this.service.listUsers(p, q);
  }
  @AdminAccess('users.read') @Get('users/:id') user(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('id', uuid()) id: string,
  ) {
    return this.service.user(p, id);
  }
  @AdminAccess('users.write') @Post('users/:id/actions') userAction(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('id', uuid()) id: string,
    @Body() b: UserActionDto,
    @Req() req: Request,
  ) {
    return this.service.userAction(p, id, b, requestId(req));
  }
  @AdminAccess('products.read') @Get('products') products(
    @CurrentAdmin() p: AdminPrincipal,
    @Query() q: ControlQueryDto,
  ) {
    return this.service.listProducts(p, q);
  }
  @AdminAccess('products.read') @Get('products/:id') product(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('id', uuid()) id: string,
  ) {
    return this.service.product(p, id);
  }
  @AdminAccess('products.moderate') @Post('products/:id/moderation') moderate(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('id', uuid()) id: string,
    @Body() b: ProductModerationDto,
    @Req() req: Request,
  ) {
    return this.service.moderateProduct(p, id, b, requestId(req));
  }
  @AdminAccess('subscriptions.read') @Get('subscriptions') subscriptions(
    @CurrentAdmin() p: AdminPrincipal,
    @Query() q: ControlQueryDto,
  ) {
    return this.service.subscriptions(p, q);
  }
  @AdminAccess('admins.write') @Get('administrators') admins(
    @CurrentAdmin() p: AdminPrincipal,
    @Query() q: ControlQueryDto,
  ) {
    return this.service.admins(p, q);
  }
  @AdminAccess('admins.write') @Post('administrators') create(
    @CurrentAdmin() p: AdminPrincipal,
    @Body() b: AdminCreateDto,
    @Req() req: Request,
  ) {
    return this.service.createAdmin(p, b, requestId(req));
  }
  @AdminAccess('admins.write') @Post('administrators/:id/actions') adminAction(
    @CurrentAdmin() p: AdminPrincipal,
    @Param('id', uuid()) id: string,
    @Body() b: AdminActionDto,
    @Req() req: Request,
  ) {
    return this.service.adminAction(p, id, b, requestId(req));
  }
}
