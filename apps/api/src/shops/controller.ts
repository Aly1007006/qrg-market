import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentSession, type Principal } from '../auth/metadata.js';
import { requireEmptyBody } from '../auth/dto.js';
import {
  AddMemberDto,
  ListQueryDto,
  MemberRoleDto,
  ShopNameDto,
} from './dto.js';
import { ShopsService } from './service.js';

const uuid = () => new ParseUUIDPipe({ version: '4' });

@ApiTags('private shops')
@ApiCookieAuth('seller-session')
@Controller({ path: 'shops', version: '1' })
export class ShopsController {
  constructor(@Inject(ShopsService) private readonly shops: ShopsService) {}
  @Get() list(
    @CurrentSession() principal: Principal,
    @Query() query: ListQueryDto,
  ) {
    return this.shops.list(principal, query);
  }
  @Post() create(
    @CurrentSession() principal: Principal,
    @Body() body: ShopNameDto,
  ) {
    return this.shops.create(principal, body.name);
  }
  @Get(':shopId') get(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
  ) {
    return this.shops.get(principal, shopId);
  }
  @Patch(':shopId') rename(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
    @Body() body: ShopNameDto,
  ) {
    return this.shops.rename(principal, shopId, body.name);
  }
  @Get(':shopId/members') members(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.shops.members(principal, shopId, query);
  }
  @Get(':shopId/members/:memberId') member(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
    @Param('memberId', uuid()) memberId: string,
  ) {
    return this.shops.member(principal, shopId, memberId);
  }
  @Post(':shopId/members') addMember(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
    @Body() body: AddMemberDto,
  ) {
    return this.shops.addMember(principal, shopId, body);
  }
  @Patch(':shopId/members/:memberId') changeRole(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
    @Param('memberId', uuid()) memberId: string,
    @Body() body: MemberRoleDto,
  ) {
    return this.shops.changeRole(principal, shopId, memberId, body);
  }
  @Delete(':shopId/members/:memberId')
  @HttpCode(204)
  removeMember(
    @CurrentSession() principal: Principal,
    @Param('shopId', uuid()) shopId: string,
    @Param('memberId', uuid()) memberId: string,
    @Body() body: unknown,
  ) {
    requireEmptyBody(body);
    return this.shops.removeMember(principal, shopId, memberId);
  }
}
