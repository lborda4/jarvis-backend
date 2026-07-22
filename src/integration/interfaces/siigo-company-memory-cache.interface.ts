import { SiigoCatalogCache } from './siigo-catalog-cache.interface';

export interface SiigoCompanyMemoryCache {
  fetchedAt: number;
  catalog: SiigoCatalogCache;
  supportDocumentId: number;
  purchaseDocumentId: number;
}
