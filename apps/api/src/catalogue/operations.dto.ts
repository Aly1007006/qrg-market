import { Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductCreateDto, CatalogQueryDto } from './dto.js';

export class DraftContentDto extends PartialType(
  OmitType(ProductCreateDto, ['status', 'slug'] as const),
) {}
export class DraftSaveDto {
  @ApiProperty() @IsInt() @Min(0) @Max(2147483646) version!: number;
  @ApiProperty({ type: DraftContentDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DraftContentDto)
  content!: DraftContentDto;
}
export class ProductListQueryDto extends CatalogQueryDto {
  @ApiPropertyOptional({ enum: ['', 'available', 'unavailable'] })
  @IsIn(['', 'available', 'unavailable'])
  stock = '';
  @ApiPropertyOptional({ enum: ['', 'DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsIn(['', 'DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status = '';
}
export class BulkProductDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
  @ApiProperty({ enum: ['HIDE', 'PUBLISH', 'AVAILABILITY', 'ARCHIVE'] })
  @IsIn(['HIDE', 'PUBLISH', 'AVAILABILITY', 'ARCHIVE'])
  action!: 'HIDE' | 'PUBLISH' | 'AVAILABILITY' | 'ARCHIVE';
  @ApiPropertyOptional() @IsBoolean() available = true;
}
export class ImageOrderDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ids!: string[];
}
export class OnboardingDto {
  @ApiProperty({ enum: ['SKIP', 'RESUME', 'REVIEW'] })
  @IsIn(['SKIP', 'RESUME', 'REVIEW'])
  action!: 'SKIP' | 'RESUME' | 'REVIEW';
}
