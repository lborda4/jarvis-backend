import { Injectable } from '@nestjs/common';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';
import { SiigoProductsCatalogService } from './siigo-products-catalog.service';

@Injectable()
export class SiigoCatalogSyncService {
  constructor(
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly siigoCostCentersCatalogService: SiigoCostCentersCatalogService,
    private readonly siigoProductsCatalogService: SiigoProductsCatalogService,
  ) {}

  async syncCatalogs(companyId: string): Promise<void> {
    await this.siigoConfigurationCacheService.syncCatalogs(companyId);
    await this.siigoCostCentersCatalogService.listCostCenters(companyId);
    await this.siigoProductsCatalogService.listProducts(companyId);
  }
}
