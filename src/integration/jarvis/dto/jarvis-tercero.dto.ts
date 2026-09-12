import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JarvisClientType } from '../enums/jarvis-client-type.enum';
import { JarvisDocumentType } from '../enums/jarvis-document-type.enum';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisFiscalRegime } from '../enums/jarvis-fiscal-regime.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';
import { JarvisVatRegime } from '../enums/jarvis-vat-regime.enum';

export class CreateJarvisTerceroRequestDto {
  @ApiProperty({
    enum: JarvisDocumentType,
    example: JarvisDocumentType.NIT,
  })
  document_type: JarvisDocumentType;

  @ApiProperty({ example: '900123456' })
  document_number: string;

  @ApiProperty({ example: 'Proveedor Ejemplo SAS' })
  name: string;

  @ApiPropertyOptional({ example: '1' })
  check_digit?: string;

  @ApiPropertyOptional({ enum: JarvisEntityType })
  entity_type?: JarvisEntityType;

  @ApiPropertyOptional({ enum: JarvisTaxRegime })
  tax_regime?: JarvisTaxRegime;

  @ApiPropertyOptional({ enum: JarvisClientType, example: JarvisClientType.CLIENT })
  client_type?: JarvisClientType;

  @ApiPropertyOptional({ enum: JarvisFiscalRegime, example: JarvisFiscalRegime.ORDINARY })
  fiscal_regime?: JarvisFiscalRegime;

  @ApiPropertyOptional({ enum: JarvisVatRegime, example: JarvisVatRegime.RESPONSIBLE })
  vat_regime?: JarvisVatRegime;

  @ApiPropertyOptional({ example: '4649 - Comercio al por mayor' })
  economic_activity?: string;

  @ApiPropertyOptional({ example: 'contacto@ejemplo.com' })
  email?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Calle 100 #10-20' })
  address?: string;

  @ApiPropertyOptional({ example: 'Colombia' })
  country?: string;

  @ApiPropertyOptional({ example: 'Bogotá D.C.' })
  city?: string;

  @ApiPropertyOptional({ example: '11001' })
  city_code?: string;
}

export class UpdateJarvisTerceroRequestDto {
  @ApiProperty({ example: 'Proveedor Ejemplo SAS' })
  name: string;

  @ApiPropertyOptional({ example: '1' })
  check_digit?: string;

  @ApiPropertyOptional({ enum: JarvisEntityType })
  entity_type?: JarvisEntityType;

  @ApiPropertyOptional({ enum: JarvisTaxRegime })
  tax_regime?: JarvisTaxRegime;

  @ApiPropertyOptional({ enum: JarvisClientType, example: JarvisClientType.CLIENT })
  client_type?: JarvisClientType;

  @ApiPropertyOptional({ enum: JarvisFiscalRegime, example: JarvisFiscalRegime.ORDINARY })
  fiscal_regime?: JarvisFiscalRegime;

  @ApiPropertyOptional({ enum: JarvisVatRegime, example: JarvisVatRegime.RESPONSIBLE })
  vat_regime?: JarvisVatRegime;

  @ApiPropertyOptional({ example: '4649 - Comercio al por mayor' })
  economic_activity?: string;

  @ApiPropertyOptional({ example: 'contacto@ejemplo.com' })
  email?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Calle 100 #10-20' })
  address?: string;

  @ApiPropertyOptional({ example: 'Colombia' })
  country?: string;

  @ApiPropertyOptional({ example: 'Bogotá D.C.' })
  city?: string;

  @ApiPropertyOptional({ example: '11001' })
  city_code?: string;
}

export class JarvisTerceroDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: JarvisDocumentType })
  document_type: string;

  @ApiProperty()
  document_number: string;

  @ApiPropertyOptional({ nullable: true })
  check_digit: string | null;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ enum: JarvisEntityType, nullable: true })
  entity_type: JarvisEntityType | null;

  @ApiPropertyOptional({ enum: JarvisTaxRegime, nullable: true })
  tax_regime: JarvisTaxRegime | null;

  @ApiPropertyOptional({ enum: JarvisClientType, nullable: true })
  client_type: JarvisClientType | null;

  @ApiPropertyOptional({ enum: JarvisFiscalRegime, nullable: true })
  fiscal_regime: JarvisFiscalRegime | null;

  @ApiPropertyOptional({ enum: JarvisVatRegime, nullable: true })
  vat_regime: JarvisVatRegime | null;

  @ApiPropertyOptional({ nullable: true })
  economic_activity: string | null;

  @ApiPropertyOptional({ nullable: true })
  email: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true })
  address: string | null;

  @ApiPropertyOptional({ nullable: true })
  country: string | null;

  @ApiPropertyOptional({ nullable: true })
  city: string | null;

  @ApiPropertyOptional({ nullable: true })
  city_code: string | null;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}

export class JarvisTercerosListResponseDto {
  @ApiProperty({ type: [JarvisTerceroDto] })
  items: JarvisTerceroDto[];

  @ApiProperty()
  total: number;
}

export class CreateJarvisTerceroResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: JarvisTerceroDto })
  tercero: JarvisTerceroDto;
}

export class UpdateJarvisTerceroResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ type: JarvisTerceroDto })
  tercero: JarvisTerceroDto;
}

export class JarvisCatalogOptionDto {
  @ApiPropertyOptional({ nullable: true, example: '11001' })
  code: string | null;

  @ApiProperty({ example: 'Bogotá D.C.' })
  name: string;
}

export class JarvisCatalogListResponseDto {
  @ApiProperty({ type: [JarvisCatalogOptionDto] })
  items: JarvisCatalogOptionDto[];

  @ApiProperty({ example: 1093 })
  total: number;
}

export class LookupJarvisTerceroNitRequestDto {
  @ApiProperty({
    enum: JarvisDocumentType,
    example: JarvisDocumentType.NIT,
  })
  document_type: JarvisDocumentType;

  @ApiProperty({ example: '900123456' })
  identification_number: string;
}

export class LookupJarvisTerceroNitResponseDto {
  @ApiProperty()
  found: boolean;

  @ApiProperty()
  document_number: string;

  @ApiPropertyOptional({ nullable: true })
  check_digit: string | null;

  @ApiPropertyOptional({ nullable: true })
  name: string | null;

  @ApiPropertyOptional({ nullable: true })
  email: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true })
  address: string | null;

  @ApiPropertyOptional({ nullable: true })
  cityCode: string | null;

  @ApiPropertyOptional({ nullable: true })
  cityName: string | null;

  @ApiPropertyOptional({ nullable: true })
  stateCode: string | null;
}
