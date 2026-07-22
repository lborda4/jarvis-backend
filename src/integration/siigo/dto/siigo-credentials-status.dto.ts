import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SiigoCredentialsStatusResponseDto {
  @ApiProperty({
    description:
      'Indica si la empresa activa ya tiene credenciales SIIGO guardadas.',
  })
  configured: boolean;

  @ApiPropertyOptional({
    example: 'asesorias@j2s-soluciones.com',
    description: 'Usuario SIIGO configurado para la empresa activa.',
  })
  username?: string;

  @ApiPropertyOptional({
    example: 'harvis',
    description: 'Partner ID configurado para la empresa activa.',
  })
  partner_id?: string;
}
