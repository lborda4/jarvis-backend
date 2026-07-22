import { SiigoCatalogCache } from '../../interfaces/siigo-catalog-cache.interface';
import { SIIGO_CONFIGURATION_CACHE_TTL_MS } from '../constants/siigo-configuration-cache.constants';

export function isSiigoMemoryCacheFresh(
  fetchedAt: number | undefined,
  ttlMs = SIIGO_CONFIGURATION_CACHE_TTL_MS,
): boolean {
  if (!fetchedAt || !Number.isFinite(fetchedAt)) {
    return false;
  }

  return Date.now() - fetchedAt < ttlMs;
}

export function hasUsableSiigoCatalogCache(
  cache?: SiigoCatalogCache | null,
): boolean {
  if (!cache) {
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
