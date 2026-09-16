import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoginDto } from '../auth/dto.js';
import { shopStatus } from '../db/schema.js';
export class AdminLoginDto extends LoginDto {
  @ApiPropertyOptional({ writeOnly: true })
  @Matches(/^(?:\d{6}|[A-Za-z0-9_-]{32}|)$/)
  code = '';
}
export class AdminQueryDto {
  @ApiPropertyOptional() @IsString() @MaxLength(100) q = '';
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') resourceId?: string;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page =
    1;
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(shopStatus.enumValues)
  status?: (typeof shopStatus.enumValues)[number];
}
export class ModerationDecisionDto {
  @ApiProperty({
    enum: ['APPROVE', 'REQUEST_CHANGES', 'REJECT', 'SUSPEND', 'RESTORE'],
  })
  @IsIn(['APPROVE', 'REQUEST_CHANGES', 'REJECT', 'SUSPEND', 'RESTORE'])
  action!: 'APPROVE' | 'REQUEST_CHANGES' | 'REJECT' | 'SUSPEND' | 'RESTORE';
  @ApiProperty({ enum: shopStatus.enumValues })
  @IsIn(shopStatus.enumValues)
  expectedStatus!: (typeof shopStatus.enumValues)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID('4') caseId?: string | null;
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.normalize('NFC').trim() : value,
  )
  @Matches(/^(?:[^\p{Cc}<>]|\n|\r|\t)*$/u)
  reason?: string;
}
