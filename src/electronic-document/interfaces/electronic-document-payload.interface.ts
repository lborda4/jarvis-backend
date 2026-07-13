import type { DianInvoiceTotals } from '../../dian/interfaces/dian-invoice-result.interface';
import type { ElectronicDocumentItem } from './electronic-document-item.interface';

export interface ElectronicDocumentSupplier {
  documentNumber: string;
  documentType: string;
  name: string;
  commercialName?: string;
  checkDigit?: string;
  address?: string;
  countryCode?: string;
  stateCode?: string;
  cityCode?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  comments?: string;
}

export interface ElectronicDocumentInvoice {
  cufe: string;
  prefix?: string;
  number: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
}

export interface ElectronicDocumentTax {
  type: string;
  amount: number;
}

export interface ElectronicDocumentPayload {
  supplier: ElectronicDocumentSupplier;
  invoice: ElectronicDocumentInvoice;
  items: ElectronicDocumentItem[];
  taxes: ElectronicDocumentTax[];
  totals: DianInvoiceTotals;
}
