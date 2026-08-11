import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
  SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
} from './constants/siigo.constants';
import { SiigoDocumentTypeCatalogItemDto } from './dto/list-siigo-document-types.dto';
import {
  SaveSiigoDocumentTypesRequestDto,
  SaveSiigoDocumentTypesResponseDto,
} from './dto/save-siigo-document-types.dto';
import {
  areSiigoDocumentTypesConfigured,
  normalizeSiigoCredentials,
} from './helpers/siigo-credentials.helper';
import { isValidSiigoConfigurationId } from './helpers/siigo-document-type.helper';
import { getSiigoIntegration } from './helpers/siigo-context.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { SiigoDocumentType } from './interfaces/siigo-api.interface';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoConfigurationCacheService } from './siigo-configuration-cache.service';
import { SiigoHttpClient } from './clients/siigo-http.client';

@Injectable()
export class SiigoDocumentTypesService {
  private readonly logger = new Logger(SiigoDocumentTypesService.name);

  constructor(
    private readonly siigoHttpClient: SiigoHttpClient,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoConfigurationCacheService: SiigoConfigurationCacheService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly planSubscriptionService: PlanSubscriptionService,
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

  async listDocumentTypesForCompany(
    companyId: string,
    type:
      | typeof SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY
      | typeof SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
  ): Promise<SiigoDocumentTypeCatalogItemDto[]> {
    const documentTypes = await executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      `consultar tipos de documento ${type}`,
      (accessToken, partnerId) =>
        this.siigoHttpClient.listDocumentTypes(accessToken, type, partnerId),
    );

    return documentTypes
      .filter(
        (item) =>
          isValidSiigoConfigurationId(item.id) && item.active !== false,
      )
      .map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        type: item.type,
        active: item.active,
      }));
  }

  async saveDocumentTypeSelection(
    companyId: string,
    request: SaveSiigoDocumentTypesRequestDto,
  ): Promise<SaveSiigoDocumentTypesResponseDto> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const subscription = await this.planSubscriptionService.getSubscription(
      trimmedCompanyId,
      IntegrationProvider.SIIGO,
    );
    const included = subscription.includedDocumentTypes ?? [];
    const needsSupport = included.includes(
      ElectronicDocumentType.SUPPORT_DOCUMENT,
    );
    const needsPurchase = included.includes(
      ElectronicDocumentType.PURCHASE_INVOICE,
    );

    if (!needsSupport && !needsPurchase) {
      throw new BadRequestException(
        'El plan actual no incluye Documento soporte ni Factura de compra.',
      );
    }

    const supportDocumentTypeId = request.supportDocumentTypeId;
    const purchaseInvoiceTypeId = request.purchaseInvoiceTypeId;

    if (needsSupport && !isValidSiigoConfigurationId(supportDocumentTypeId)) {
      throw new BadRequestException(
        'Seleccione el comprobante de Documento soporte.',
      );
    }

    if (needsPurchase && !isValidSiigoConfigurationId(purchaseInvoiceTypeId)) {
      throw new BadRequestException(
        'Seleccione el comprobante de Factura de compra.',
      );
    }

    if (needsSupport && isValidSiigoConfigurationId(supportDocumentTypeId)) {
      await this.assertDocumentTypeExists(
        trimmedCompanyId,
        SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY,
        supportDocumentTypeId,
      );
    }

    if (needsPurchase && isValidSiigoConfigurationId(purchaseInvoiceTypeId)) {
      await this.assertDocumentTypeExists(
        trimmedCompanyId,
        SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
        purchaseInvoiceTypeId,
      );
    }

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      trimmedCompanyId,
    );
    const credentials = normalizeSiigoCredentials(integration.credentials);

    const nextDocumentTypes = {
      ...(credentials.document_types ?? {}),
      ...(isValidSiigoConfigurationId(supportDocumentTypeId)
        ? { support_document_id: supportDocumentTypeId }
        : {}),
      ...(isValidSiigoConfigurationId(purchaseInvoiceTypeId)
        ? { purchase_invoice_id: purchaseInvoiceTypeId }
        : {}),
    };

    const updatedCredentials = {
      ...credentials,
      document_types: nextDocumentTypes,
    };

    await this.integrationsRepository.updateCredentials(
      integration,
      updatedCredentials,
    );

    this.siigoConfigurationCacheService.invalidateCompanyCache(
      trimmedCompanyId,
    );

    const documentTypesConfigured = areSiigoDocumentTypesConfigured(
      updatedCredentials,
      included,
    );

    this.logger.log(
      `[companyId=${trimmedCompanyId}] Comprobantes SIIGO guardados (DS=${nextDocumentTypes.support_document_id ?? 'n/a'}, FC=${nextDocumentTypes.purchase_invoice_id ?? 'n/a'})`,
    );

    return {
      supportDocumentTypeId: nextDocumentTypes.support_document_id ?? null,
      purchaseInvoiceTypeId: nextDocumentTypes.purchase_invoice_id ?? null,
      documentTypesConfigured,
    };
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

  private async assertDocumentTypeExists(
    companyId: string,
    type:
      | typeof SIIGO_SUPPORT_DOCUMENT_TYPE_QUERY
      | typeof SIIGO_PURCHASE_DOCUMENT_TYPE_QUERY,
    documentTypeId: number,
  ): Promise<void> {
    const catalog = await this.listDocumentTypesForCompany(companyId, type);
    const found = catalog.some((item) => item.id === documentTypeId);

    if (!found) {
      throw new BadRequestException(
        `El comprobante seleccionado (${documentTypeId}) no está disponible en SIIGO para tipo ${type}.`,
      );
    }
  }
}
