export class PurchaseInvoiceDownloadPartyDto {
  contributorType?: string | null;
  fiscalRegime?: string | null;
  taxResponsibility?: string | null;
  economicActivity?: string | null;

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
  unitCode?: string | null;
  incAmount?: number | null;
  incPercentage?: number | null;

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
  issueTime?: string | null;
  operationType?: string | null;
  orderNumber?: string | null;
  orderDate?: string | null;
  exchangeRate?: number | null;
  prepaidAmount?: number | null;
  taxExclusiveAmount?: number | null;
  taxInclusiveAmount?: number | null;
  technologyProviderId?: string | null;
  references?: Array<{
    type: string;
    number: string | null;
    date: string | null;
  }>;
  authorization?: {
    number: string | null;
    from: string | null;
    to: string | null;
    startDate: string | null;
    endDate: string | null;
  };

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
