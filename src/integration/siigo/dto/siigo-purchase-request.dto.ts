export class SiigoPurchaseItemTaxDto {
  id: number;
}

export class SiigoPurchaseItemDto {
  type: string;
  code: string;
  description?: string;
  quantity: number;
  price: number;
  taxes?: SiigoPurchaseItemTaxDto[];
}

export class SiigoPurchasePaymentDto {
  id: number;
  value: number;
  due_date?: string;
}

export class SiigoPurchaseRequestDto {
  document: { id: number };
  number?: number;
  date: string;
  supplier: {
    identification: string;
    branch_office: number;
  };
  cost_center?: number;
  provider_invoice: {
    prefix: string;
    number: string;
  };
  observations?: string;
  items: SiigoPurchaseItemDto[];
  payments: SiigoPurchasePaymentDto[];
}
