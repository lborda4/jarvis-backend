import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class CreateJarvisSupportDocumentRetentionDto {
  @ApiProperty({ example: 6 })
  id: number;

  @ApiPropertyOptional({ example: 'ReteRenta' })
  type?: string;

  @ApiPropertyOptional({ example: 2.5 })
  percentage?: number;
}

export class CreateJarvisSupportDocumentPaymentDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiPropertyOptional({ example: 1, description: '1=Contado, 2=Crédito' })
  payment_form_id?: number;

  @ApiPropertyOptional({ example: '2026-08-05' })
  due_date?: string;
}

export class CreateJarvisSupportDocumentRequestDto {
  @ApiProperty()
  documentId: string;

  @ApiProperty({ example: '2026-08-05' })
  date: string;

  @ApiPropertyOptional()
  observations?: string;

  @ApiPropertyOptional({ type: [CreateJarvisSupportDocumentRetentionDto] })
  retentions?: CreateJarvisSupportDocumentRetentionDto[];

  @ApiPropertyOptional({ type: CreateJarvisSupportDocumentPaymentDto })
  payment?: CreateJarvisSupportDocumentPaymentDto;
}

export class CreateJarvisSupportDocumentResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  supportDocument: {
    id: string;
    number?: number | string;
    consecutive?: string;
    prefix?: string;
    date: string;
    cude?: string | null;
  };

  @ApiProperty({ type: ElectronicDocumentResponseDto })
  document: ElectronicDocumentResponseDto;
}

export class JarvisCatalogItemDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  code?: string | null;

  @ApiPropertyOptional({ nullable: true })
  type?: string | null;

  @ApiPropertyOptional({ nullable: true })
  percentage?: number | null;
}

export class JarvisCatalogsResponseDto {
  @ApiProperty({ type: [JarvisCatalogItemDto] })
  taxes: JarvisCatalogItemDto[];

  @ApiProperty({ type: [JarvisCatalogItemDto] })
  paymentMethods: JarvisCatalogItemDto[];

  @ApiProperty({ type: [JarvisCatalogItemDto] })
  paymentForms: JarvisCatalogItemDto[];

  @ApiProperty({ type: [JarvisCatalogItemDto] })
  currencies: JarvisCatalogItemDto[];
}

export class CreateManualJarvisSupportDocumentItemDto {
  @ApiProperty({ example: 'Servicio de consultoría' })
  description: string;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ example: 100000 })
  unitValue: number;

  @ApiPropertyOptional({ example: 0 })
  discount?: number;

  @ApiPropertyOptional({
    example: 19000,
    description: 'IVA u otro impuesto a cargo de la línea',
  })
  taxAmount?: number;

  @ApiPropertyOptional({ example: 'PRUEBA' })
  code?: string;
}

export class CreateManualJarvisSupportDocumentRequestDto {
  @ApiProperty({ example: '2026-06-11' })
  issueDate: string;

  @ApiProperty({ example: 'NIT' })
  supplierDocumentType: string;

  @ApiProperty({ example: '900123456' })
  supplierIdentification: string;

  @ApiPropertyOptional({ example: 'Proveedor Ejemplo SAS' })
  supplierName?: string;

  @ApiPropertyOptional({
    example: 'COP',
    description: 'Código ISO de moneda (tabla maestra type_currencies)',
  })
  currency?: string;

  @ApiProperty({ example: 'DS' })
  documentPrefix: string;

  @ApiProperty({ example: '1001' })
  documentNumber: string;

  @ApiPropertyOptional()
  observations?: string;

  @ApiProperty({ type: [CreateManualJarvisSupportDocumentItemDto] })
  items: CreateManualJarvisSupportDocumentItemDto[];

  @ApiPropertyOptional({ type: [CreateJarvisSupportDocumentRetentionDto] })
  retentions?: CreateJarvisSupportDocumentRetentionDto[];

  @ApiPropertyOptional({ type: CreateJarvisSupportDocumentPaymentDto })
  payment?: CreateJarvisSupportDocumentPaymentDto;

  @ApiPropertyOptional({
    example: true,
    description: 'Si es true, guarda y envía el documento a NextPyme/DIAN',
  })
  send?: boolean;
}

export class CreateManualJarvisSupportDocumentResponseDto {
  @ApiProperty()
  documentId: string;

  @ApiProperty()
  sent: boolean;

  @ApiProperty({ type: ElectronicDocumentResponseDto })
  document: ElectronicDocumentResponseDto;

  @ApiPropertyOptional()
  supportDocument?: CreateJarvisSupportDocumentResponseDto['supportDocument'];
}
