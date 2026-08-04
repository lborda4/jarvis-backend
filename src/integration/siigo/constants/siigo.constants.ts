export const SIIGO_API_BASE_URL = 'https://api.siigo.com';
export const SIIGO_AUTH_PATH = '/auth';
export const SIIGO_CUSTOMERS_PATH = '/v1/customers';
export const SIIGO_PURCHASES_PATH = '/v1/purchases';
export const SIIGO_DOCUMENT_TYPES_PATH = '/v1/document-types';
export const SIIGO_PURCHASE_SUPPORT_DOCUMENTS_PATH =
  '/v1/purchase-support-documents';
export const SIIGO_PAYMENT_TYPES_PATH = '/v1/payment-types';
export const SIIGO_TAXES_PATH = '/v1/taxes';
export const SIIGO_COST_CENTERS_PATH = '/v1/cost-centers';
export const SIIGO_TEST_BALANCE_PATH = '/v1/test-balance-report';

export const SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE = 'FC';
export const SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT = 'DS';
export const SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY = 'DS';
export const SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY = 'FC';
export const SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED = false;

export const SIIGO_SUPPLIER_TYPE = 'Supplier';
export const SIIGO_COMPANY_PERSON_TYPE = 'Company';
export const SIIGO_PERSON_PERSON_TYPE = 'Person';
export const SIIGO_NIT_ID_TYPE = '31';
export const SIIGO_CEDULA_ID_TYPE = '13';
export const SIIGO_PURCHASE_ITEM_TYPE_ACCOUNT = 'Account';

export const SIIGO_DOCUMENT_SEND_INTERVAL_MS = 1000;
export const SIIGO_DOCUMENT_SEND_MAX_RETRIES = 3;
export const SIIGO_DOCUMENT_SEND_RETRY_DELAY_MS = 1000;
export const SIIGO_DOCUMENT_SEND_DUPLICATE_MAX_RETRIES = 2;
export const SIIGO_DOCUMENT_SEND_DUPLICATE_RETRY_DELAY_MS = 5000;

export const SIIGO_DOCUMENT_SEND_RETRY_OPTIONS = {
  maxGenericRetries: 0,
  genericRetryDelayMs: SIIGO_DOCUMENT_SEND_RETRY_DELAY_MS,
  maxDuplicatedDocumentRetries: SIIGO_DOCUMENT_SEND_DUPLICATE_MAX_RETRIES,
  duplicatedDocumentRetryDelayMs: SIIGO_DOCUMENT_SEND_DUPLICATE_RETRY_DELAY_MS,
} as const;
