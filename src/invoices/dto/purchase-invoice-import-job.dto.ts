import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoicePreviewDto } from './invoice-preview.dto';
import { PurchaseInvoiceValidationReportDto } from './purchase-invoice-import-validation.dto';

export class StartPurchaseInvoiceImportResponseDto {
  @ApiProperty()
  jobId: string;

  @ApiProperty()
  totalRows: number;
}

export class PurchaseInvoiceImportFailedRowDetailDto {
  @ApiProperty()
  rowIndex: number;

  @ApiProperty()
  cufe: string;

  @ApiProperty()
  issuerNit: string;

  @ApiProperty()
  issuerName: string;

  @ApiProperty()
  errorMessage: string;
}

export class PurchaseInvoiceImportStatusResponseDto {
  @ApiPropertyOptional({ nullable: true })
  jobId: string | null;

  @ApiProperty({
    enum: ['pending', 'running', 'completed', 'error'],
    nullable: true,
  })
  status: 'pending' | 'running' | 'completed' | 'error' | null;

  @ApiProperty()
  processedRows: number;

  @ApiPropertyOptional({ nullable: true })
  totalRows: number | null;

  @ApiProperty()
  successCount: number;

  @ApiProperty()
  errorCount: number;

  @ApiProperty({ description: '0-100, null si totalRows todavía no se conoce.' })
  progressPercent: number | null;

  @ApiPropertyOptional({ nullable: true })
  itemsTotal: number | null;

  @ApiPropertyOptional({ nullable: true })
  documentsCreated: number | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  documentIds: string[] | null;

  @ApiPropertyOptional({ type: [InvoicePreviewDto], nullable: true })
  records: InvoicePreviewDto[] | null;

  @ApiProperty({
    type: [PurchaseInvoiceImportFailedRowDetailDto],
    description:
      'Detalle de filas fallidas (hasta 200) — se llena incrementalmente por lote, no solo al terminar.',
  })
  failedRows: PurchaseInvoiceImportFailedRowDetailDto[];

  @ApiPropertyOptional({
    type: PurchaseInvoiceValidationReportDto,
    nullable: true,
    description:
      'Presente solo si el job terminó en error porque la validación previa encontró filas inválidas en el Excel.',
  })
  validation: PurchaseInvoiceValidationReportDto | null;

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null;

  @ApiPropertyOptional({ nullable: true })
  startedAt: string | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt: string | null;
}
