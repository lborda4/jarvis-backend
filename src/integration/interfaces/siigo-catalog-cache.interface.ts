export interface SiigoCachedAccountCatalogItem {
  code: string;
  name: string;
}

export interface SiigoCachedPaymentTypeCatalogItem {
  id: number;
  name: string;
  type: string;
  dueDate: boolean;
  documentType: string;
}

export interface SiigoCachedTaxCatalogItem {
  id: number;
  name: string;
  type: string;
  percentage: number;
  active: boolean;
}

export interface SiigoCachedCostCenterCatalogItem {
  id: number;
  code: string;
  name: string;
}

export interface SiigoCatalogCache {
  lastSync?: string;
  accounts?: SiigoCachedAccountCatalogItem[];
  paymentTypes?: Record<string, SiigoCachedPaymentTypeCatalogItem[]>;
  taxes?: SiigoCachedTaxCatalogItem[];
  costCenters?: SiigoCachedCostCenterCatalogItem[];
}
