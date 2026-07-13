import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveSiigoCredentialsRequestDto {
  @ApiProperty({
    example: 'asesorias@j2s-soluciones.com',
    description: 'Usuario de acceso a la API de SIIGO.',
  })
  username: string;

  @ApiProperty({
    example: 'MDJhUlbk0=',
    description: 'Access key de SIIGO.',
  })
  access_key: string;

  @ApiPropertyOptional({
    example: 'harvis',
    description: 'Partner ID de SIIGO.',
  })
  partner_id?: string;
}

export class SaveSiigoCredentialsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ example: 'asesorias@j2s-soluciones.com' })
  username: string;

  @ApiPropertyOptional({ example: 'harvis' })
  partner_id?: string;

  @ApiProperty({
    example: '2026-07-10T00:39:53.871Z',
    description:
      'Fecha de expiración del token, calculada al autenticar contra SIIGO.',
  })
  expires_at: string;
}
