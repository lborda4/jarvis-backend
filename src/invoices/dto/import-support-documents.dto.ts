import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceFiltersDto } from './invoice-filters.dto';
import { InvoicePreviewDto } from './invoice-preview.dto';

export class ExtractSupportDocumentsResponseDto {
  @ApiProperty()
  processedRows: number;

  @ApiProperty()
  itemsTotal: number;

  @ApiProperty()
  total: number;

  @ApiProperty({ type: InvoiceFiltersDto })
  filters: InvoiceFiltersDto;

  @ApiProperty({ type: [InvoicePreviewDto] })
  records: InvoicePreviewDto[];
}

export class ImportSupportDocumentsRequestDto {
  @ApiPropertyOptional({
    description:
      'ID de la empresa receptora. Si no se envía, se usa el NIT receptor del Excel o la primera empresa configurada.',
  })
  companyId?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de emisión (YYYY-MM-DD) enviada por el front. Si no se envía, se usa la del Excel cuando exista.',
    example: '2026-06-10',
  })
  issueDate?: string;
}

export class ImportSupportDocumentsResponseDto {
  @ApiProperty()
  processedRows: number;

  @ApiProperty()
  itemsTotal: number;

  @ApiProperty()
  documentsCreated: number;

  @ApiProperty({ type: [String] })
  documentIds: string[];

  @ApiProperty({ type: [InvoicePreviewDto] })
  records: InvoicePreviewDto[];
}
