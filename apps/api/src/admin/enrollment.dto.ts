import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class AdminPasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(1, 128)
  currentPassword!: string;
  @ApiProperty({ writeOnly: true })
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}
export class AdminTotpDto {
  @ApiProperty({ writeOnly: true }) @Matches(/^\d{6}$/) code!: string;
}
