import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JarvisDocumentType } from '../enums/jarvis-document-type.enum';
import { JarvisEntityType } from '../enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';

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

  @ApiPropertyOptional({ example: 'contacto@ejemplo.com' })
  email?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  phone?: string;

  @ApiPropertyOptional({ example: 'Calle 100 #10-20' })
  address?: string;
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

  @ApiPropertyOptional({ nullable: true })
  email: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true })
  address: string | null;

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
