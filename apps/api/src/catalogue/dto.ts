import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class ProductFieldsDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(1, 200) name!: string;
  @ApiProperty()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(120)
  slug!: string;
  @ApiProperty() @IsUUID('4') categoryId!: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID('4') brandId?:
    string | null;
  @ApiPropertyOptional() @IsString() @MaxLength(10000) description = '';
  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  basePrice!: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  oldPrice?: number | null;
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' = 'DRAFT';
}
export class VariantDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 40)
  size?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 40)
  color?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 100)
  sku?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  priceOverride?: number | null;
  @ApiPropertyOptional() @IsBoolean() available = true;
}
export class ProductCreateDto extends ProductFieldsDto {
  @ApiProperty({ type: [VariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[] = [new VariantDto()];
}
export class LocationDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(1, 300) address!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @Length(1, 150)
  mall?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    example: 'https://2gis.kz/karaganda/firm/70000001038483747',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  twoGisUrl?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^[0-9]{10,20}$/)
  twoGisFirmId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
export class ContactsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsappPhone?: string | null;
}
export class CatalogQueryDto {
  @ApiPropertyOptional() @IsString() @Transform(trim) @MaxLength(100) q = '';
  @ApiPropertyOptional() @IsString() @MaxLength(100) category = '';
  @ApiPropertyOptional() @IsString() @MaxLength(100) subcategory = '';
  @ApiPropertyOptional() @IsString() @MaxLength(100) brand = '';
  @ApiPropertyOptional() @IsString() @MaxLength(120) shop = '';
  @ApiPropertyOptional() @IsString() @MaxLength(150) mall = '';
  @ApiPropertyOptional() @IsString() @MaxLength(40) size = '';
  @ApiPropertyOptional() @IsString() @MaxLength(40) color = '';
  @ApiPropertyOptional() @Matches(/^(?:|\d{1,8}(?:\.\d{1,2})?)$/) priceMin = '';
  @ApiPropertyOptional() @Matches(/^(?:|\d{1,8}(?:\.\d{1,2})?)$/) priceMax = '';
  @ApiPropertyOptional() @IsIn(['', 'available']) availability = '';
  @ApiPropertyOptional() @IsIn(['', 'true']) discount = '';
  @ApiPropertyOptional() @IsIn(['', 'new', 'price-asc', 'price-desc']) sort =
    '';
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page =
    1;
  @ApiPropertyOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit =
    8;
}
export class AutocompleteQueryDto {
  @ApiProperty() @IsString() @Transform(trim) @Length(2, 100) q!: string;
}
