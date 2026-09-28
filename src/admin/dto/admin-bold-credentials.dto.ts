import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class SaveAdminBoldCredentialsDto {
  @ApiProperty({ description: 'Llave de identidad de Bold.', maxLength: 4096 })
  identityKey: string;
  @ApiPropertyOptional({
    description:
      'Llave secreta. Omitir o dejar vacía para conservar la guardada.',
    maxLength: 4096,
  })
  secretKey?: string;
}
export class AdminBoldCredentialsStatusDto {
  @ApiProperty()
  identityKey: string;
  @ApiProperty()
  hasSecretKey: boolean;
}
