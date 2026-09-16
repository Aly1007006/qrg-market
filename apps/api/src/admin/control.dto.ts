import { Type, Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export const platformRoles = [
  'SUPER_ADMIN',
  'MODERATION_ADMIN',
  'SUPPORT_ADMIN',
  'FINANCE_ADMIN',
] as const;
export class ControlQueryDto {
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page =
    1;
  @ApiPropertyOptional() @IsString() @MaxLength(100) q = '';
}
export class ReasonDto {
  @ApiProperty()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(3, 2000)
  reason!: string;
}
export class UserActionDto extends ReasonDto {
  @ApiProperty({ enum: ['DISABLE', 'ENABLE', 'REVOKE_SESSIONS', 'SHOP_ROLE'] })
  @IsIn(['DISABLE', 'ENABLE', 'REVOKE_SESSIONS', 'SHOP_ROLE'])
  action!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') membershipId?: string;
  @ApiPropertyOptional({
    enum: ['SHOP_OWNER', 'SHOP_MANAGER', 'SHOP_EMPLOYEE'],
  })
  @IsOptional()
  @IsIn(['SHOP_OWNER', 'SHOP_MANAGER', 'SHOP_EMPLOYEE'])
  role?: 'SHOP_OWNER' | 'SHOP_MANAGER' | 'SHOP_EMPLOYEE';
}
export class ProductModerationDto extends ReasonDto {
  @ApiProperty({ enum: ['HIDE', 'RESTORE'] })
  @IsIn(['HIDE', 'RESTORE'])
  action!: 'HIDE' | 'RESTORE';
}
export class AdminCreateDto extends ReasonDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(12, 128)
  temporaryPassword!: string;
  @ApiProperty({ enum: platformRoles })
  @IsIn(platformRoles)
  role!: (typeof platformRoles)[number];
}
export class AdminActionDto extends ReasonDto {
  @ApiProperty({ enum: ['DEACTIVATE', 'REVOKE_SESSIONS', 'CHANGE_ROLE'] })
  @IsIn(['DEACTIVATE', 'REVOKE_SESSIONS', 'CHANGE_ROLE'])
  action!: string;
  @ApiPropertyOptional({ enum: platformRoles })
  @IsOptional()
  @IsIn(platformRoles)
  role?: (typeof platformRoles)[number];
}
