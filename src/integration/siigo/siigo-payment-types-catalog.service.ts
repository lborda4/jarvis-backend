import { Injectable } from '@nestjs/common';
import {
  ListSiigoPaymentTypesQueryDto,
  SiigoPaymentTypeCatalogItemDto,
} from './dto/list-siigo-payment-types.dto';
import { resolveSiigoPaymentDocumentType } from './helpers/siigo-payment-document-type.helper';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';

@Injectable()
export class SiigoPaymentTypesCatalogService {
  constructor(
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
  ) {}

  async listPaymentTypes(
    query: ListSiigoPaymentTypesQueryDto,
    companyId: string,
  ): Promise<SiigoPaymentTypeCatalogItemDto[]> {
    const documentType = resolveSiigoPaymentDocumentType(query.documentType);

    return this.siigoConfigurationCacheService.getPaymentTypes(
      documentType,
      companyId,
    );
  }

  /** No bloqueante: ver SiigoConfigurationCacheService.getPaymentTypesFromCacheOnly. */
  listPaymentTypesFromCacheOnly(
    query: ListSiigoPaymentTypesQueryDto,
    companyId: string,
  ): SiigoPaymentTypeCatalogItemDto[] {
    const documentType = resolveSiigoPaymentDocumentType(query.documentType);

    return this.siigoConfigurationCacheService.getPaymentTypesFromCacheOnly(
      documentType,
      companyId,
    );
  }
}
