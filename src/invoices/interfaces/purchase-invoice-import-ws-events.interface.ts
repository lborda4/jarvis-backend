import { PurchaseInvoiceImportRowStatus } from '../enums/purchase-invoice-import-row-status.enum';

export interface PurchaseInvoiceImportProgressEvent {
  jobId: string;
  processedRows: number;
  totalRows: number | null;
  successCount: number;
  errorCount: number;
  progressPercent: number | null;
}

export interface PurchaseInvoiceImportRowResultEvent {
  jobId: string;
  rowIndex: number;
  cufe: string;
  issuerNit: string;
  issuerName: string;
  status:
    | PurchaseInvoiceImportRowStatus.SUCCESS
    | PurchaseInvoiceImportRowStatus.FAILED;
  errorMessage: string | null;
  documentId: string | null;
}
