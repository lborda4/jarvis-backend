import { Injectable } from '@nestjs/common';
import { SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY } from './constants/siigo.constants';
import { SiigoDocumentType } from './interfaces/siigo-api.interface';
import { SiigoHttpClient } from './clients/siigo-http.client';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';

@Injectable()
export class SiigoDocumentTypesService {
  constructor(
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
  ) {}

  async listSupportDocumentTypes(
    accessToken: string,
    partnerId?: string,
  ): Promise<SiigoDocumentType[]> {
    return this.siigoHttpClient.listDocumentTypes(
      accessToken,
      SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
      partnerId,
    );
  }

  async resolveSupportDocumentTypeId(companyId: string): Promise<number> {
    return this.siigoConfigurationCacheService.getSupportDocumentTypeId(
      companyId,
    );
  }

  async resolvePurchaseDocumentTypeId(companyId: string): Promise<number> {
    return this.siigoConfigurationCacheService.getPurchaseDocumentTypeId(
      companyId,
    );
  }
}
