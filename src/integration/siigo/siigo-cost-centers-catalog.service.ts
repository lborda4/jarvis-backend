import { Injectable, Logger } from '@nestjs/common';
import { SiigoCostCenterCatalogItemDto } from './dto/list-siigo-cost-centers.dto';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SIIGO_COST_CENTERS_CACHE_TTL_MS } from './constants/siigo-configuration-cache.constants';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SiigoAuthService } from './siigo-auth.service';

interface CostCentersMemoryCacheEntry {
  fetchedAt: number;
  items: SiigoCostCenterCatalogItemDto[];
}

@Injectable()
export class SiigoCostCentersCatalogService {
  private readonly logger = new Logger(SiigoCostCentersCatalogService.name);
  private readonly memoryCacheByCompany = new Map<
    string,
    CostCentersMemoryCacheEntry
  >();
  private readonly refreshInProgressByCompany = new Map<
    string,
    Promise<void>
  >();

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  /**
   * Variante no bloqueante para armar sugerencias en el listado de
   * documentos — esa consulta ya corre en cada carga/poll de la tabla y no
   * puede esperar un refresh en frío contra SIIGO (mismo criterio que
   * SiigoProductsCatalogService.listProductsFromCacheOnly). Si la caché en
   * memoria está fría, dispara un refresh de fondo (deduplicado por
   * companyId) y devuelve lo que haya en ese momento, aunque sea `[]`.
   */
  listCostCentersFromCacheOnly(
    companyId: string,
  ): SiigoCostCenterCatalogItemDto[] {
    const cached = this.memoryCacheByCompany.get(companyId);
    const isFresh =
      cached && Date.now() - cached.fetchedAt < SIIGO_COST_CENTERS_CACHE_TTL_MS;

    if (!isFresh && !this.refreshInProgressByCompany.has(companyId)) {
      const refreshPromise = this.listCostCenters(companyId)
        .then(() => undefined)
        .catch((error) => {
          this.logger.warn(
            `[companyId=${companyId}] Refresh en segundo plano de catálogo de centros de costo SIIGO falló.`,
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

  async listCostCenters(
    companyId: string,
  ): Promise<SiigoCostCenterCatalogItemDto[]> {
    const cached = this.memoryCacheByCompany.get(companyId);

    if (
      cached &&
      Date.now() - cached.fetchedAt < SIIGO_COST_CENTERS_CACHE_TTL_MS
    ) {
      return cached.items;
    }

    const items = await this.fetchCostCentersFromSiigo(companyId);

    this.memoryCacheByCompany.set(companyId, {
      fetchedAt: Date.now(),
      items,
    });

    return items;
  }

  private async fetchCostCentersFromSiigo(
    companyId: string,
  ): Promise<SiigoCostCenterCatalogItemDto[]> {
    const costCenters = await executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar centros de costo',
      (accessToken, partnerId) =>
        this.siigoHttpClient.listCostCenters(accessToken, partnerId),
    );

    return costCenters
      .filter((costCenter) => costCenter.active !== false)
      .map((costCenter) => ({
        id: costCenter.id,
        code: costCenter.code?.trim() || String(costCenter.id),
        name: costCenter.name?.trim() || `Centro ${costCenter.id}`,
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }),
      );
  }
}
