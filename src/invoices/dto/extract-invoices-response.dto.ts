import { InvoiceFiltersDto } from './invoice-filters.dto';
import { InvoicePreviewDto } from './invoice-preview.dto';

export class ExtractInvoicesResponseDto {
  total: number;
  filters: InvoiceFiltersDto;
  records: InvoicePreviewDto[];
}
