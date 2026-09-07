import { Injectable } from '@nestjs/common';
import {
  ListSiigoTaxesQueryDto,
  SiigoTaxCatalogItemDto,
} from './dto/list-siigo-taxes.dto';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';

@Injectable()
export class SiigoTaxesCatalogService {
  constructor(
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
  ) {}

  async listTaxes(
    query: ListSiigoTaxesQueryDto,
    companyId: string,
  ): Promise<SiigoTaxCatalogItemDto[]> {
    return this.siigoConfigurationCacheService.getTaxes(query.type, companyId);
  }

  /** No bloqueante: ver SiigoConfigurationCacheService.getTaxesFromCacheOnly. */
  listTaxesFromCacheOnly(
    query: ListSiigoTaxesQueryDto,
    companyId: string,
  ): SiigoTaxCatalogItemDto[] {
    return this.siigoConfigurationCacheService.getTaxesFromCacheOnly(
      query.type,
      companyId,
    );
  }
}
