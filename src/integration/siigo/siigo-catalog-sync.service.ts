import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoCostCentersCatalogService } from './siigo-cost-centers-catalog.service';
import { SiigoProductsCatalogService } from './siigo-products-catalog.service';
import { SiigoFixedAssetsCatalogService } from './siigo-fixed-assets-catalog.service';

@Injectable()
export class SiigoCatalogSyncService {
  constructor(
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly siigoCostCentersCatalogService: SiigoCostCentersCatalogService,
    private readonly siigoProductsCatalogService: SiigoProductsCatalogService,
    private readonly siigoFixedAssetsCatalogService: SiigoFixedAssetsCatalogService,
  ) {}

  async syncCatalogs(companyId: string, force = false): Promise<void> {
    await this.siigoConfigurationCacheService.syncCatalogs(companyId);
    await this.siigoCostCentersCatalogService.listCostCenters(companyId, force);
    await this.siigoProductsCatalogService.listProducts(companyId, force);
    await this.siigoFixedAssetsCatalogService.listFixedAssets(companyId, force);
  }
}
