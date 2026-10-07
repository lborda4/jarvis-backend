import { Injectable, Logger } from '@nestjs/common';
import { SiigoFixedAssetCatalogItemDto } from './dto/list-siigo-fixed-assets.dto';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SIIGO_FIXED_ASSETS_CACHE_TTL_MS } from './constants/siigo-configuration-cache.constants';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SiigoAuthService } from './siigo-auth.service';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { SiigoFixedAsset } from './interfaces/siigo-api.interface';

interface FixedAssetsMemoryCacheEntry {
  fetchedAt: number;
  items: SiigoFixedAssetCatalogItemDto[];
}

const FIXED_ASSETS_PAGE_SIZE = 100;
const FIXED_ASSETS_MAX_PAGES = 500;
const FIXED_ASSETS_PAGE_FETCH_CONCURRENCY = 5;

@Injectable()
export class SiigoFixedAssetsCatalogService {
  private readonly logger = new Logger(SiigoFixedAssetsCatalogService.name);
  private readonly memoryCacheByCompany = new Map<
    string,
    FixedAssetsMemoryCacheEntry
  >();
  private readonly refreshInProgressByCompany = new Map<string, Promise<void>>();

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  async listFixedAssets(
    companyId: string,
    force = false,
  ): Promise<SiigoFixedAssetCatalogItemDto[]> {
    const cached = this.memoryCacheByCompany.get(companyId);

    if (
      !force &&
      cached &&
      Date.now() - cached.fetchedAt < SIIGO_FIXED_ASSETS_CACHE_TTL_MS
    ) {
      return cached.items;
    }

    const items = await this.fetchFixedAssetsFromSiigo(companyId);

    this.memoryCacheByCompany.set(companyId, {
      fetchedAt: Date.now(),
      items,
    });

    return items;
  }

  listFixedAssetsFromCacheOnly(companyId: string): SiigoFixedAssetCatalogItemDto[] {
    const cached = this.memoryCacheByCompany.get(companyId);
    const isFresh =
      cached && Date.now() - cached.fetchedAt < SIIGO_FIXED_ASSETS_CACHE_TTL_MS;

    if (!isFresh && !this.refreshInProgressByCompany.has(companyId)) {
      const refreshPromise = this.listFixedAssets(companyId)
        .then(() => undefined)
        .catch((error) => {
          this.logger.warn(
            `[companyId=${companyId}] Refresh en segundo plano de catálogo de activos fijos SIIGO falló.`,
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => {
          this.refreshInProgressByCompany.delete(companyId);
        });

      this.refreshInProgressByCompany.set(companyId, refreshPromise);
    }

    return cached?.items ?? [];
  }

  private async fetchPage(companyId: string, page: number) {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar activos fijos',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listFixedAssets(
          accessToken,
          page,
          FIXED_ASSETS_PAGE_SIZE,
          partnerId,
        ),
    );
  }

  private async fetchFixedAssetsFromSiigo(
    companyId: string,
  ): Promise<SiigoFixedAssetCatalogItemDto[]> {
    const firstPage = await this.fetchPage(companyId, 1);
    const totalResults = firstPage.pagination?.total_results ?? 0;
    const totalPages = Math.min(
      FIXED_ASSETS_MAX_PAGES,
      Math.max(1, Math.ceil(totalResults / FIXED_ASSETS_PAGE_SIZE)),
    );

    const allAssets: SiigoFixedAsset[] = [...(firstPage.results ?? [])];

    if (totalPages > 1) {
      const remainingPages = Array.from(
        { length: totalPages - 1 },
        (_, index) => index + 2,
      );

      const pageResults = await mapWithConcurrency(
        remainingPages,
        FIXED_ASSETS_PAGE_FETCH_CONCURRENCY,
        async (page) => {
          const response = await this.fetchPage(companyId, page);
          return response.results ?? [];
        },
      );

      for (const results of pageResults) {
        allAssets.push(...results);
      }
    }

    return allAssets
      .filter((asset) => asset.active !== false)
      .map((asset) => ({
        code: asset.code?.trim() || String(asset.id),
        name: asset.name?.trim() || `Activo ${asset.id}`,
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }),
      );
  }
}
