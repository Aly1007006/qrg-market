import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Matches, MaxLength } from 'class-validator';
export class AnalyticsEventDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  eventId!: string;
  @ApiProperty({
    enum: ['SHOP_VIEW', 'PRODUCT_VIEW', 'WHATSAPP_CLICK', 'TWO_GIS_CLICK'],
  })
  @IsIn(['SHOP_VIEW', 'PRODUCT_VIEW', 'WHATSAPP_CLICK', 'TWO_GIS_CLICK'])
  type!: 'SHOP_VIEW' | 'PRODUCT_VIEW' | 'WHATSAPP_CLICK' | 'TWO_GIS_CLICK';
  @ApiProperty({ enum: ['shop', 'product'] })
  @IsIn(['shop', 'product'])
  resource!: 'shop' | 'product';
  @ApiProperty({ maxLength: 120 })
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(120)
  slug!: string;
}
export class AnalyticsQueryDto {
  @ApiProperty({ enum: [7, 30, 90], default: 7, required: false })
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days: number = 7;
}
