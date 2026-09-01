import { ApiProperty } from '@nestjs/swagger';

export class PurchaseInvoiceValidationRowErrorDto {
  @ApiProperty()
  rowIndex: number;

  @ApiProperty()
  cufe: string;

  @ApiProperty()
  issuerNit: string;

  @ApiProperty()
  issuerName: string;

  @ApiProperty()
  reason: string;
}

export class PurchaseInvoiceValidationReportDto {
  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  validRows: number;

  @ApiProperty()
  invalidRows: number;

  @ApiProperty({ type: [PurchaseInvoiceValidationRowErrorDto] })
  errors: PurchaseInvoiceValidationRowErrorDto[];
}
