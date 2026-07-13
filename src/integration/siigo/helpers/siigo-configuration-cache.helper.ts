import { IntegrationConfiguration } from '../../interfaces/integration-configuration.interface';
import { SiigoCatalogCache } from '../../interfaces/siigo-catalog-cache.interface';
import { SIIGO_CONFIGURATION_CACHE_TTL_MS } from '../constants/siigo-configuration-cache.constants';
import { isValidSiigoConfigurationId } from './siigo-document-type.helper';

export function isSiigoCatalogCacheFresh(
  lastSync?: string,
  ttlMs = SIIGO_CONFIGURATION_CACHE_TTL_MS,
): boolean {
  if (!lastSync?.trim()) {
    return false;
  }

  const syncedAt = Date.parse(lastSync);

  if (Number.isNaN(syncedAt)) {
    return false;
  }

  return Date.now() - syncedAt < ttlMs;
}

export function hasUsableSiigoCatalogCache(
  cache?: SiigoCatalogCache | null,
): boolean {
  if (!cache?.lastSync) {
    return false;
  }

  return (
    Array.isArray(cache.accounts) &&
    Array.isArray(cache.taxes) &&
    Boolean(cache.paymentTypes) &&
    typeof cache.paymentTypes === 'object'
  );
}

export function buildSiigoCatalogCacheTimestamp(): string {
  return new Date().toISOString();
}

export function hasStoredSiigoDocumentTypeIds(
  configuration?: IntegrationConfiguration | null,
): boolean {
  return (
    isValidSiigoConfigurationId(configuration?.supportDocumentId) &&
    isValidSiigoConfigurationId(configuration?.purchaseDocumentId)
  );
}

export function isSiigoConfigurationFresh(
  configuration?: IntegrationConfiguration | null,
  ttlMs = SIIGO_CONFIGURATION_CACHE_TTL_MS,
): boolean {
  return (
    isSiigoCatalogCacheFresh(configuration?.catalogCache?.lastSync, ttlMs) &&
    hasUsableSiigoCatalogCache(configuration?.catalogCache) &&
    hasStoredSiigoDocumentTypeIds(configuration)
  );
}
