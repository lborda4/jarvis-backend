export interface SupportDocumentExcelRow {
  supplierIdentification: string;
  supplierDocumentType: string;
  supplierName: string;
  documentPrefix: string;
  documentNumber: string;
  issueDate: string;
  dueDate?: string;
  cufe?: string;
  receiverIdentification?: string;
  currency?: string;
  itemDescription: string;
  quantity: number;
  unitValue: number;
  lineTotal: number;
  taxAmount: number;
}

export interface GroupedSupportDocument {
  groupKey: string;
  supplierIdentification: string;
  supplierDocumentType: string;
  supplierName: string;
  documentPrefix: string;
  documentNumber: string;
  issueDate: string;
  dueDate?: string;
  cufe?: string;
  receiverIdentification?: string;
  currency: string;
  rows: SupportDocumentExcelRow[];
}
