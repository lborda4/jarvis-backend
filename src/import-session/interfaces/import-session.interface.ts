import { DianInvoiceResult } from '../../dian/interfaces/dian-invoice-result.interface';

export interface ImportSessionData {
  rquid: string;
  parsedInvoice: DianInvoiceResult;
  electronicDocumentId?: string;
  companyId?: string;
  createdAt: string;
  updatedAt: string;
}
