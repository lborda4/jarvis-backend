import type { SiigoCatalogCache } from './siigo-catalog-cache.interface';

export interface IntegrationConfiguration {
  purchaseDocumentId?: number;
  purchaseNumber?: number;
  supportDocumentId?: number;
  supportDocumentSendStamp?: boolean;
  paymentTypeId?: number;
  defaultTaxId?: number;
  costCenter?: number;
  catalogCache?: SiigoCatalogCache;
  [key: string]: unknown;
}
