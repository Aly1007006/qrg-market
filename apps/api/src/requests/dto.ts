import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { customerRequestStatus } from '../db/schema.js';
export const PRIVACY_VERSION = 'request-privacy-v1';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.normalize('NFC').trim() : value;
// Plain text, no markup/control characters. React escapes text at every output boundary.
const plain = /^(?:[^\p{Cc}<>]|\n|\r|\t)*$/u;
export class CreateRequestDto {
  @ApiProperty() @IsUUID('4') productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') variantId?: string | null;
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(plain)
  name!: string;
  @ApiProperty({ example: '+7 (700) 000-00-00' })
  @Transform(trim)
  @IsString()
  @Length(8, 40)
  phone!: string;
  @ApiProperty({ minimum: 1, maximum: 99 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
  @ApiPropertyOptional({ enum: ['SHOP_PICKUP', 'DISCUSS_WITH_SELLER'] })
  @IsOptional()
  @IsIn(['SHOP_PICKUP', 'DISCUSS_WITH_SELLER'])
  pickupPreference?: string | null;
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  @Matches(plain)
  comment?: string | null;
  @ApiProperty({ enum: [true] }) @Equals(true) privacyConsent!: boolean;
  @ApiProperty({ enum: [PRIVACY_VERSION] })
  @Equals(PRIVACY_VERSION)
  policyVersion!: string;
  @ApiProperty() @IsString() @Length(20, 300) challenge!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}
export class RequestQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
  @ApiPropertyOptional({ enum: customerRequestStatus.enumValues })
  @IsOptional()
  @IsIn(customerRequestStatus.enumValues)
  status?: (typeof customerRequestStatus.enumValues)[number];
}
export class RequestStatusDto {
  @ApiProperty({ enum: customerRequestStatus.enumValues })
  @IsIn(customerRequestStatus.enumValues)
  status!: (typeof customerRequestStatus.enumValues)[number];
  @ApiProperty({ enum: customerRequestStatus.enumValues })
  @IsIn(customerRequestStatus.enumValues)
  expectedStatus!: (typeof customerRequestStatus.enumValues)[number];
}
