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

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoHttpClient: SiigoHttpClient,
  ) {}

  async listCostCenters(companyId: string): Promise<SiigoCostCenterCatalogItemDto[]> {
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
