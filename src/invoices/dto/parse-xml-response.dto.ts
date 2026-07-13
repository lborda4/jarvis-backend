export class ParseXmlImportSummaryDto {
  supplierName: string;
  supplierDocument: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: number;
}

export class ParseXmlResponseDto {
  success: boolean;
  id: string;
  rquid: string;
  summary: ParseXmlImportSummaryDto;
}
