import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CreateJarvisSupportDocumentPaymentDto,
  CreateJarvisSupportDocumentRetentionDto,
} from './create-jarvis-support-document.dto';

export class CreateJarvisInvoiceItemDto {
  @ApiPropertyOptional({ type: CreateJarvisSupportDocumentRetentionDto })
  retention?: CreateJarvisSupportDocumentRetentionDto;
  @ApiProperty({ example: 'Comisión por servicios' })
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

  @ApiPropertyOptional({ description: 'ID del tipo de impuesto en el catálogo de facturación; por defecto IVA.' })
  taxId?: number;

  @ApiPropertyOptional({ example: 'COMISION' })
  code?: string;

  @ApiPropertyOptional()
  notes?: string;
}

export class CreateJarvisInvoiceRequestDto {
  @ApiPropertyOptional({ description: 'Consecutivo explícito de la nota crédito.' })
  number?: number;
  @ApiPropertyOptional({ description: 'Prefijo de la nota crédito enviado a NextPyme.' })
  prefix?: string;
  @ApiPropertyOptional()
  billingReference?: { number: string; uuid: string; issueDate: string };
  @ApiPropertyOptional()
  discrepancyResponseCode?: number;
  @ApiPropertyOptional()
  discrepancyResponseDescription?: string;
  @ApiPropertyOptional()
  seze?: string;
  @ApiPropertyOptional()
  sendmail?: boolean;
  @ApiPropertyOptional()
  sendmailtome?: boolean;

  @ApiProperty({ example: '2026-08-05' })
  issueDate: string;

  @ApiProperty({ example: 'NIT' })
  customerDocumentType: string;

  @ApiProperty({ example: '901249232' })
  customerIdentification: string;

  @ApiPropertyOptional({ example: 'Cliente Ejemplo SAS' })
  customerName?: string;

  @ApiPropertyOptional({
    example: 'COP',
    description: 'Código ISO de moneda (tabla maestra type_currencies)',
  })
  currency?: string;

  @ApiPropertyOptional()
  observations?: string;

  @ApiPropertyOptional({
    description: 'Texto libre para el encabezado de la representación gráfica',
  })
  headNote?: string;

  @ApiPropertyOptional({
    description:
      'Texto libre para el pie de página de la representación gráfica',
  })
  footNote?: string;

  @ApiProperty({ type: [CreateJarvisInvoiceItemDto] })
  items: CreateJarvisInvoiceItemDto[];

  @ApiPropertyOptional({
    example: 0,
    description: 'Descuento general a nivel de documento (no por ítem)',
  })
  discountAmount?: number;

  @ApiPropertyOptional({ type: [CreateJarvisSupportDocumentRetentionDto] })
  retentions?: CreateJarvisSupportDocumentRetentionDto[];

  @ApiPropertyOptional({ type: CreateJarvisSupportDocumentPaymentDto })
  payment?: CreateJarvisSupportDocumentPaymentDto;
}

export class CreateJarvisInvoiceResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  invoice: {
    historyId?: string;
    id: string;
    number?: number | string;
    consecutive?: string;
    prefix?: string;
    date: string;
    cufe?: string | null;
  };
}
