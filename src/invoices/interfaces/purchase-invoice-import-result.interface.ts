export interface PurchaseInvoiceImportRecord {
  cufe: string;
  documentType: string;
  issueDate: string;
  receptionDate: string;
  issuerNit: string;
  issuerName: string;
  receiverNit: string;
  receiverName: string;
  currency: string;
  paymentMethod: string;
  total: number;
  status: string;
  group: string;
}

export interface PurchaseInvoiceImportFailedRow {
  cufe: string;
  issuerNit: string;
  issuerName: string;
  error: string;
}
