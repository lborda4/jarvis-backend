export class SiigoSupportDocumentItemTaxDto {
  id: number;
}

export class SiigoSupportDocumentRetentionDto {
  id: number;
}

export class SiigoSupportDocumentItemDto {
  type: string;
  code: string;
  description?: string;
  quantity: number;
  price: number;
  taxes?: SiigoSupportDocumentItemTaxDto[];
}

export class SiigoSupportDocumentPaymentDto {
  id: number;
  value: number;
  due_date?: string;
}

export class SiigoSupportDocumentRequestDto {
  document: { id: number };
  date: string;
  supplier: {
    identification: string;
    branch_office: number;
  };
  supplier_receipt_number: {
    prefix: string;
    number: string;
  };
  observations?: string;
  stamp?: {
    send: boolean;
  };
  retentions?: SiigoSupportDocumentRetentionDto[];
  items: SiigoSupportDocumentItemDto[];
  payments: SiigoSupportDocumentPaymentDto[];
  cost_center?: number;
}
