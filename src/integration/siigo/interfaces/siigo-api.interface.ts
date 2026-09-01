export interface SiigoAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface SiigoCustomerAddress {
  address: string;
  city: {
    country_code: string;
    state_code: string;
    city_code: string;
  };
}

export interface SiigoCustomer {
  id: string;
  type: string;
  person_type: string;
  id_type: string;
  identification: string;
  check_digit?: string;
  name: string[];
  commercial_name: string;
  active: boolean;
  address?: {
    address?: string;
    city?: {
      country_code?: string;
      state_code?: string;
      city_code?: string;
    };
    postal_code?: string;
  };
  phones?: Array<{ number?: string }>;
  contacts?: Array<{ email?: string }>;
}

export interface SiigoCustomersListResponse {
  pagination?: {
    page: number;
    page_size: number;
    total_results: number;
  };
  results: SiigoCustomer[];
}

export interface SiigoDocumentType {
  id: number;
  code?: string;
  name?: string;
  type?: string;
  active?: boolean;
}

export interface SiigoPurchaseItem {
  type: string;
  code: string;
  description: string;
  quantity: number;
  price: number;
}

export interface SiigoPurchasePayment {
  id: number;
  value: number;
}

export interface SiigoPaymentType {
  id: number;
  name: string;
  type: string;
  active: boolean;
  due_date: boolean;
}

export interface SiigoTax {
  id: number;
  name: string;
  type: string;
  percentage: number;
  active: boolean;
}

export interface SiigoCostCenter {
  id: number;
  code: string;
  name: string;
  active: boolean;
}

export interface SiigoPurchaseResponseTax {
  id: number;
  name: string;
  type: string;
  percentage: number;
  value: number;
}

export interface SiigoPurchaseResponseItem {
  id: string;
  type: string;
  code: string;
  quantity: number;
  price: number;
  discount: number;
  description: string;
  total: number;
  taxes: SiigoPurchaseResponseTax[];
}

export interface SiigoPurchaseResponseRetention {
  id: number;
  name: string;
  /** Código numérico interno de SIIGO para el tipo de retención (no confundir con SiigoTax.type). */
  type: number;
  percentage: number;
  value: number;
}

/** Medio de pago usado en la compra — `id` es el mismo id del catálogo de
 * formas de pago de SIIGO (`/v1/payment-types`). */
export interface SiigoPurchaseResponsePayment {
  id: number;
  name: string;
  value: number;
  due_date?: string;
}

export interface SiigoPurchaseResponse {
  id: string;
  document: { id: number };
  number: number;
  name: string;
  date: string;
  supplier: {
    id?: string;
    identification: string;
    branch_office: number;
  };
  total: number;
  balance?: number;
  provider_invoice: {
    prefix: string;
    number: string;
  };
  observations?: string;
  items?: SiigoPurchaseResponseItem[];
  retentions?: SiigoPurchaseResponseRetention[];
  payments?: SiigoPurchaseResponsePayment[];
}

export interface SiigoPurchasesListResponse {
  pagination: {
    page: number;
    page_size: number;
    total_results: number;
  };
  results: SiigoPurchaseResponse[];
}

/** Ítem del catálogo de productos SIIGO (GET /v1/products). Solo se
 * declaran los campos que realmente consumimos — la respuesta real trae
 * bastantes más (precios, impuestos, grupo de cuenta, etc.). */
export interface SiigoProduct {
  id: string;
  code: string;
  name: string;
  active?: boolean;
}

export interface SiigoProductsListResponse {
  pagination: {
    page: number;
    page_size: number;
    total_results: number;
  };
  results: SiigoProduct[];
}

export interface SiigoSupportDocumentResponse {
  id: string;
  document: { id: number };
  number?: number;
  name?: string;
  date: string;
  supplier: {
    identification: string;
    branch_office: number;
  };
  total?: number;
  supplier_receipt_number?: {
    prefix: string;
    number: string;
  };
}

export interface SiigoSupportDocumentDeleteResponse {
  id: string;
  deleted: boolean;
}

export interface SiigoTestBalanceReportRequest {
  account_start?: string;
  account_end?: string;
  year: number;
  month_start: number;
  month_end: number;
  includes_tax_difference: boolean;
}

export interface SiigoTestBalanceReportResponse {
  file_id: string;
  file_url: string;
}
