import { ApiProperty } from '@nestjs/swagger';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';

export class SaveJarvisCredentialsRequestDto {
  @ApiProperty({
    example: 'J2S Soluciones SAS',
    description: 'Razón social de la empresa.',
  })
  business_name: string;

  @ApiProperty({
    example: 'Consultoría en tecnologías de la información',
    description: 'Actividad económica principal.',
  })
  economic_activity: string;

  @ApiProperty({
    enum: JarvisEntityType,
    example: JarvisEntityType.LEGAL_ENTITY,
    description: 'Indica si el contribuyente es persona natural o jurídica.',
  })
  entity_type: JarvisEntityType;

  @ApiProperty({
    enum: JarvisTaxRegime,
    example: JarvisTaxRegime.COMMON,
    description: 'Régimen tributario del contribuyente.',
  })
  tax_regime: JarvisTaxRegime;
}

export class SaveJarvisCredentialsResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ example: 'J2S Soluciones SAS' })
  business_name: string;

  @ApiProperty({
    example: '2026-07-20T12:00:00.000Z',
    description: 'Fecha en la que se completó la configuración inicial.',
  })
  configured_at: string;
}
