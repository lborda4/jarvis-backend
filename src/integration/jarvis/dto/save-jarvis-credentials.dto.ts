import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CompanyPersonType } from '../../../company/enums/company-person-type.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../enums/jarvis-vat-regime.enum';

export class SaveJarvisCredentialsRequestDto {
  @ApiPropertyOptional({ example: 7.66, default: 0, minimum: 0, description: 'Tarifa de ICA por mil. Vacío u omitido se guarda en cero.' })
  ica_rate?: number;
  @ApiPropertyOptional({ enum: CompanyPersonType })
  person_type?: CompanyPersonType;

  @ApiPropertyOptional()
  given_names?: string;

  @ApiPropertyOptional()
  surnames?: string;

  @ApiProperty({
    example: 'J2S Soluciones SAS',
    description: 'Razón social o nombre completo de la persona natural.',
  })
  business_name: string;

  @ApiPropertyOptional({
    example: 'J2S',
    description: 'Nombre comercial (opcional).',
  })
  trade_name?: string;

  @ApiProperty({
    enum: JarvisTaxRegime,
    example: JarvisTaxRegime.COMMON,
    description: 'Tipo de régimen tributario.',
  })
  tax_regime: JarvisTaxRegime;

  @ApiProperty({
    enum: JarvisVatRegime,
    example: JarvisVatRegime.RESPONSIBLE,
    description: 'Régimen de IVA: responsable o no responsable.',
  })
  vat_regime: JarvisVatRegime;

  @ApiProperty({
    enum: JarvisTaxResponsibility,
    example: JarvisTaxResponsibility.NOT_APPLICABLE,
    description: 'Responsabilidad tributaria DIAN.',
  })
  tax_responsibility: JarvisTaxResponsibility;

  @ApiProperty({
    example: 'Consultoría en tecnologías de la información',
    description: 'Actividad económica principal.',
  })
  economic_activity: string;

  @ApiProperty({ example: 'Colombia' })
  country: string;

  @ApiProperty({ example: 'Cundinamarca' })
  department: string;

  @ApiProperty({ example: 'Bogotá D.C.' })
  municipality: string;

  @ApiProperty({ example: 'Bogotá' })
  city: string;

  @ApiProperty({ example: 'contacto@empresa.com' })
  email: string;

  @ApiProperty({ example: 'Calle 100 #10-20' })
  address: string;

  @ApiProperty({ example: '3001234567' })
  phone: string;
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
