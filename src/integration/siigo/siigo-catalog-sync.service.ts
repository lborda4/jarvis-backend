import { Injectable } from '@nestjs/common';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';

@Injectable()
export class SiigoCatalogSyncService {
  constructor(
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly siigoCostCentersCatalogService: SiigoCostCentersCatalogService,
  ) {}

  async syncCatalogs(companyId: string): Promise<void> {
    await this.siigoConfigurationCacheService.syncCatalogs(companyId);
    await this.siigoCostCentersCatalogService.listCostCenters(companyId);
  }
}
