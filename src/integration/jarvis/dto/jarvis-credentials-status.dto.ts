import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';

export class JarvisCredentialsStatusResponseDto {
  @ApiProperty({
    description:
      'Indica si la empresa activa ya completó la configuración inicial de Jarvis.',
  })
  configured: boolean;

  @ApiPropertyOptional({ example: 'J2S Soluciones SAS' })
  business_name?: string;

  @ApiPropertyOptional({
    example: 'Consultoría en tecnologías de la información',
  })
  economic_activity?: string;

  @ApiPropertyOptional({ enum: JarvisEntityType })
  entity_type?: JarvisEntityType;

  @ApiPropertyOptional({ enum: JarvisTaxRegime })
  tax_regime?: JarvisTaxRegime;

  @ApiPropertyOptional({ example: '2026-07-20T12:00:00.000Z' })
  configured_at?: string;
}
