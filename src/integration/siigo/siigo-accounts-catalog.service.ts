import { Injectable } from '@nestjs/common';
import { SiigoAccountCatalogItemDto } from './dto/list-siigo-accounts.dto';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';

@Injectable()
export class SiigoAccountsCatalogService {
  constructor(
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
  ) {}

  async listAccounts(companyId: string): Promise<SiigoAccountCatalogItemDto[]> {
    return this.siigoConfigurationCacheService.getAccounts(companyId);
  }
}
