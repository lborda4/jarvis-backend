export class PurchaseInvoiceDownloadPartyDto {
  name: string | null;
  tradeName: string | null;
  documentType: string | null;
  documentNumber: string | null;
  checkDigit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  countryName: string | null;
  departmentName: string | null;
  cityName: string | null;
}

export class PurchaseInvoiceDownloadItemDto {
  description: string;
  code: string | null;
  quantity: number;
  unitValue: number;
  discount: number | null;
  surcharge: number | null;
  ivaPercentage: number | null;
  ivaAmount: number | null;
  total: number;
}

export class PurchaseInvoiceDownloadTaxDto {
  type: string;
  amount: number;
}

export class PurchaseInvoiceDownloadWithholdingDto {
  dianTaxCode: string;
  name: string;
  percentage: number;
  amount: number | null;
}

export class PurchaseInvoiceDownloadDto {
  id: string;
  cufe: string;
  invoiceNumber: string | null;
  prefix: string | null;
  issueDate: string | null;
  dueDate: string | null;
  /** true = Crédito, false = Contado, null = desconocido. */
  isCreditPayment: boolean | null;
  paymentMethodName: string | null;
  currency: string;
  observations: string | null;
  issuer: PurchaseInvoiceDownloadPartyDto;
  buyer: PurchaseInvoiceDownloadPartyDto;
  items: PurchaseInvoiceDownloadItemDto[];
  taxes: PurchaseInvoiceDownloadTaxDto[];
  subtotal: number;
  iva: number;
  discount: number | null;
  surcharge: number | null;
  total: number;
  withholdings: PurchaseInvoiceDownloadWithholdingDto[];
  dianQrUrl: string;
  dianQrText: string;
}
