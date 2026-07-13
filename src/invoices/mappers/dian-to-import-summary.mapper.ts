import { DianInvoiceResult } from '../../dian/interfaces/dian-invoice-result.interface';
import { ParseXmlImportSummaryDto } from '../dto/parse-xml-response.dto';

export function mapDianResultToImportSummary(
  result: DianInvoiceResult,
): ParseXmlImportSummaryDto {
  return {
    supplierName: result.emisor.nombre,
    supplierDocument: result.emisor.nit,
    invoiceNumber: result.numeroFactura,
    invoiceDate: result.fechaEmision,
    total: result.totales.total,
  };
}
