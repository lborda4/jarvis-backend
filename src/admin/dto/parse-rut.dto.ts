import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CompanyPersonType } from '../../company/enums/company-person-type.enum';
import { JarvisTaxRegime } from '../../integration/jarvis/enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../../integration/jarvis/enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../../integration/jarvis/enums/jarvis-vat-regime.enum';

export class ParseRutUploadDto {
  @ApiProperty({ type: 'string', format: 'binary' })
  file: unknown;
}

export class ParsedRutJarvisCredentialsDto {
  @ApiPropertyOptional({ example: 'JARVIS COLOMBIA S.A.S', nullable: true })
  business_name: string | null;

  @ApiPropertyOptional({ nullable: true })
  trade_name: string | null;

  @ApiPropertyOptional({ enum: JarvisTaxRegime, nullable: true })
  tax_regime: JarvisTaxRegime | null;

  @ApiPropertyOptional({ enum: JarvisVatRegime, nullable: true })
  vat_regime: JarvisVatRegime | null;

  @ApiPropertyOptional({ enum: JarvisTaxResponsibility, nullable: true })
  tax_responsibility: JarvisTaxResponsibility | null;

  @ApiPropertyOptional({ nullable: true })
  economic_activity: string | null;

  @ApiPropertyOptional({ example: 'Colombia', nullable: true })
  country: string | null;

  @ApiPropertyOptional({ example: 'Bogotá D.C.', nullable: true })
  department: string | null;

  @ApiPropertyOptional({ example: 'Bogotá, D.C.', nullable: true })
  municipality: string | null;

  @ApiPropertyOptional({ example: 'Bogotá', nullable: true })
  city: string | null;

  @ApiPropertyOptional({ nullable: true })
  email: string | null;

  @ApiPropertyOptional({ nullable: true })
  address: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone: string | null;
}

export class ParsedRutDataDto {
  @ApiProperty({ example: '902086460' })
  nit: string;

  @ApiPropertyOptional({ example: '6', nullable: true })
  verificationDigit: string | null;

  @ApiProperty({ example: 'JARVIS COLOMBIA S.A.S' })
  name: string;

  @ApiProperty({ enum: CompanyPersonType })
  personType: CompanyPersonType;

  @ApiPropertyOptional({ example: 'CALLE 48C SUR #25-44', nullable: true })
  address: string | null;

  @ApiPropertyOptional({
    example: 'JOSLSILVAG283@GMAIL.COM',
    nullable: true,
  })
  email: string | null;

  @ApiPropertyOptional({ example: '3195355387', nullable: true })
  phone: string | null;

  @ApiPropertyOptional({ example: 'BORDA LAURA SOFIA', nullable: true })
  responsibleName: string | null;

  @ApiProperty({
    type: ParsedRutJarvisCredentialsDto,
    description:
      'Campos sugeridos para la configuración inicial Jarvis. Deben revisarse antes de guardar.',
  })
  jarvisCredentials: ParsedRutJarvisCredentialsDto;

  @ApiProperty({
    type: [String],
    description:
      'Datos que no se pudieron extraer con seguridad y deben revisarse.',
  })
  warnings: string[];
}

export class ParseRutResponseDto {
  @ApiProperty({ type: ParsedRutDataDto })
  data: ParsedRutDataDto;
}
