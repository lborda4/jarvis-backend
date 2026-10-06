import { BoundedWorkQueue } from '../../common/helpers/bounded-work-queue';
import { resolveItemAiSuggestion } from '../../electronic-document/helpers/electronic-document-ai-suggestion.helper';
import { readAiCost } from '../../electronic-document/helpers/electronic-document-ai-cost.helper';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SupplierItemAccountMappingsRepository } from '../repositories/supplier-item-account-mappings.repository';
import {
  resolveSuggestedAccountForItem,
  resolveSuggestedItemConfigFromConfiguration,
  resolveSuggestedPaymentMethodFromSync,
} from '../helpers/supplier-preference.helper';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { OpenRouterHttpClient } from '../openrouter/clients/openrouter-http.client';
import {
  SiigoAiAccountSuggestionService,
  ItemTypeAndAccountClassification,
} from './siigo-ai-account-suggestion.service';
import { applyItemClassificationToPayload } from '../../electronic-document/helpers/electronic-document-account-mapping.helper';

/**
 * Autocompleta tipo de ítem + cuenta contable al importar facturas de
 * compra, sin que el usuario tenga que pedirlo (a diferencia del botón
 * manual "Sugerir con IA" del panel de configuración, que además sugiere
 * IVA/retenciones). Solo llama IA cuando falta info confiable de cuenta o
 * medio de pago (ver `needsAiClassification`) — si ambas ya están resueltas
 * con confianza por el sync de historial, la preferencia ya sincronizada
 * alcanza y no gasta una llamada a OpenRouter.
 */
@Injectable()
export class SiigoPurchaseAiClassificationService {
  private readonly workQueue = new BoundedWorkQueue(4);
  private readonly logger = new Logger(
    SiigoPurchaseAiClassificationService.name,
  );

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly supplierItemAccountMappingsRepository: SupplierItemAccountMappingsRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly openRouterHttpClient: OpenRouterHttpClient,
    private readonly siigoAiAccountSuggestionService: SiigoAiAccountSuggestionService,
  ) {}

  classifyDocumentsInBackground(
    documentIds: string[],
    companyId: string,
  ): void {
    void this.classifyDocuments(documentIds, companyId).catch((error) => {
      this.logger.error(
        'No se pudo iniciar la clasificacion; el recuperador volvera a intentarlo.',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  async classifyDocuments(
    documentIds: string[],
    companyId: string,
  ): Promise<void> {
    if (documentIds.length === 0) {
      return;
    }

    if (!this.openRouterHttpClient.isConfigured()) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] Omitido para ${documentIds.join(', ')}: OpenRouter no está configurado (falta OPENROUTER_API_KEY).`,
      );
      return;
    }

    let integrationId: string;

    try {
      const integration = await getSiigoIntegration(
        this.integrationsRepository,
        companyId,
      );
      integrationId = integration.id;
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] Omitido para ${documentIds.join(', ')}: la empresa no tiene integración SIIGO.`,
      );
      return;
    }

    this.logger.log(
      `[companyId=${companyId}] Evaluando clasificación automática con IA para ${documentIds.length} documento(s): ${documentIds.join(', ')}`,
    );

    await Promise.all(
      documentIds.map((documentId) =>
        this.workQueue
          .run(companyId + ':' + documentId, () =>
            this.classifyOne(documentId, companyId, integrationId),
          )
          .catch((error) => {
            this.logger.error(
              `[documentId=${documentId}] Error en clasificación automática con IA`,
              error instanceof Error ? error.stack : String(error),
            );
          }),
      ),
    );
  }

  private async classifyOne(
    documentId: string,
    companyId: string,
    integrationId: string,
  ): Promise<void> {
    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] classifyOne iniciado — ${new Date().toISOString()}`,
    );

    const document = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );
    const supplierNit = normalizeSupplierDocument(
      document.payload.supplier.documentNumber ?? '',
    );

    if (
      document.alreadyInSiigo ||
      [ElectronicDocumentStatus.PURCHASE_CREATED, 'COMPLETED'].includes(
        document.status,
      )
    )
      return;
    // Reimports and recovery only need to fill missing lines.
    if (
      document.payload.items.length > 0 &&
      document.payload.items.every((item, index) => {
        const suggestion = resolveItemAiSuggestion(document.payload, index);
        return Boolean(
          item.accountMapping?.code?.trim() ||
          suggestion?.account?.code?.trim() ||
          suggestion?.product?.code?.trim(),
        );
      })
    )
      return;

    const configuration = supplierNit
      ? await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
          companyId,
          integrationId,
          supplierNit,
        )
      : null;

    const needsAi = await this.needsAiClassification(
      document.payload,
      configuration,
      companyId,
      integrationId,
      supplierNit,
    );

    console.log(`[AI-CLASSIFY] [documentId=${documentId}] needsAi=${needsAi}`);

    if (!needsAi) {
      const fromHistory = await this.classificationFromHistory(
        document.payload,
        configuration,
        companyId,
        integrationId,
        supplierNit,
      );
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] Omitido, NO se llamó a la IA: cuenta y medio de pago ya resueltos con confianza por el historial.`,
      );
      if (fromHistory) {
        await this.electronicDocumentService.updatePayload(
          documentId,
          applyItemClassificationToPayload(document.payload, fromHistory),
          companyId,
        );
      }
      return;
    }

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] ANTES de invocar classifyItemTypeAndAccount — ${new Date().toISOString()}`,
    );

    const classification = await this.siigoAiAccountSuggestionService
      .classifyItemTypeAndAccount(documentId, companyId, async (itemType) => {
        // Publica el paso 1 antes de ejecutar la recomendación del código.
        // El listado se refresca mientras corre el proceso en background,
        // por lo que puede mostrar Cuenta/Producto sin esperar el paso 2.
        const documentAfterTypeClassification =
          await this.electronicDocumentService.requireById(
            documentId,
            companyId,
          );
        const { aiSuggestion: _legacySuggestion, ...payload } =
          documentAfterTypeClassification.payload;
        const cost = readAiCost(_legacySuggestion);
        await this.electronicDocumentService.updatePayload(
          documentId,
          {
            ...payload,
            ...(cost ? { aiSuggestion: { retentions: [], ...cost } } : {}),
            items: payload.items.map((item) => ({ ...item, itemType })),
          },
          companyId,
        );
      })
      .catch((error): ItemTypeAndAccountClassification => {
        if (!(error instanceof BadGatewayException)) throw error;
        this.logger.warn(
          'IA no disponible; el documento requiere revision: ' + documentId,
        );
        return {
          itemType: null,
          accountCode: null,
          accountName: null,
          productCode: null,
          productName: null,
          confidence: 0,
          items: [],
        };
      });

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] DESPUÉS de invocar classifyItemTypeAndAccount — ${new Date().toISOString()} — itemType=${classification.itemType ?? 'null'}, accountCode=${classification.accountCode ?? 'null'}, accountName=${classification.accountName ?? 'null'}, productCode=${classification.productCode ?? 'null'}, productName=${classification.productName ?? 'null'}, confidence=${classification.confidence ?? 'null'}`,
    );

    const foundNothing =
      !classification.accountCode &&
      !classification.productCode &&
      !(classification.items ?? []).some(
        (item) => item.accountCode || item.productCode,
      );
    if (foundNothing) {
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] IA no encontró una cuenta contable ni un producto seguros (tipo=${classification.itemType ?? 'desconocido'}); se guarda igual como sugerencia vacía con confidence=0 para que el documento quede en "Requiere revisión" en vez de "Pendiente".`,
      );
    }

    // Se relee el documento en vez de reusar el `document` leído al principio
    // de esta función: la llamada a la IA tarda varios segundos, y en ese
    // tiempo SiigoDocumentPreparationService (corre en paralelo, mismo
    // documento) puede haber actualizado el payload — usar la copia vieja
    // pisaría esos cambios en vez de sumarse a ellos.
    const freshDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    await this.electronicDocumentService.updatePayload(
      documentId,
      applyItemClassificationToPayload(freshDocument.payload, classification),
      companyId,
    );
  }

  /**
   * true si falta info confiable de cuenta, de producto o de medio de pago.
   * "Confiable" acá es el mismo umbral que ya usa todo el producto:
   * VARIABILITY_THRESHOLD=0.7 en SiigoPurchaseHistorySyncService.
   * Si el historial marca tipoItem fijo (Product o Account) pero cuentaPuc
   * es variable, se salta el paso 1 (el tipo ya se sabe) y se llama a la IA
   * para elegir el código del catálogo. El medio de pago fijo no resuelve
   * ese hueco.
   */
  private async needsAiClassification(
    payload: {
      items: Array<{ descripcion: string }>;
      supplier: { documentType?: string };
    },
    configuration: Awaited<
      ReturnType<
        SupplierConfigurationsRepository['findByCompanyIntegrationAndNormalizedSupplierDocument']
      >
    >,
    companyId: string,
    integrationId: string,
    supplierNit: string,
  ): Promise<boolean> {
    if (resolveSuggestedPaymentMethodFromSync(configuration) === null) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=true: sin medio de pago fijo por historial para proveedor ${supplierNit}.`,
      );
      return true;
    }

    if (payload.items.length === 0) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=true: el documento no tiene ítems.`,
      );
      return true;
    }

    const itemConfig =
      resolveSuggestedItemConfigFromConfiguration(configuration);

    if (itemConfig?.itemType === 'Product' && !itemConfig.productCode) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=true: tipo Producto fijo para proveedor ${supplierNit} pero sin código de producto dominante (cuentaPuc variable).`,
      );
      return true;
    }

    if (itemConfig?.itemType === 'Product' && itemConfig.productCode) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=false: proveedor ${supplierNit} — medio de pago y producto ya resueltos con confianza por el historial.`,
      );
      return false;
    }

    if (itemConfig?.itemType === 'Account' && !itemConfig.accountCode) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=true: tipo Cuenta fijo para proveedor ${supplierNit} pero sin código de cuenta dominante (cuentaPuc variable).`,
      );
      return true;
    }

    if (itemConfig?.itemType === 'Account' && itemConfig.accountCode) {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=false: proveedor ${supplierNit} — medio de pago y cuenta ya resueltos con confianza por el historial.`,
      );
      return false;
    }

    const supplierDocumentType = payload.supplier.documentType?.trim() || 'NIT';

    for (const item of payload.items) {
      const itemMapping =
        await this.supplierItemAccountMappingsRepository.findOneByKey(
          companyId,
          integrationId,
          supplierDocumentType,
          supplierNit,
          item.descripcion,
        );
      const resolved = resolveSuggestedAccountForItem(
        itemMapping,
        configuration,
      );

      if (!resolved || resolved.source !== 'exact') {
        console.log(
          `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=true: ítem "${item.descripcion}" sin regla exacta (source=${resolved?.source ?? 'ninguna'}).`,
        );
        return true;
      }
    }

    console.log(
      `[AI-CLASSIFY] [companyId=${companyId}] needsAiClassification=false: proveedor ${supplierNit} — medio de pago y TODOS los ítems ya resueltos con regla exacta.`,
    );
    return false;
  }

  /** Pasa al payload la cuenta/producto que ya dio el historial, para que
   * no se reevalúe el mismo documento al volver a abrir el historial. */
  private async classificationFromHistory(
    payload: {
      items: Array<{ descripcion: string }>;
      supplier: { documentType?: string };
    },
    configuration: Awaited<
      ReturnType<
        SupplierConfigurationsRepository['findByCompanyIntegrationAndNormalizedSupplierDocument']
      >
    >,
    companyId: string,
    integrationId: string,
    supplierNit: string,
  ): Promise<ItemTypeAndAccountClassification | null> {
    const itemConfig =
      resolveSuggestedItemConfigFromConfiguration(configuration);
    const historyLine = (
      item: Partial<ItemTypeAndAccountClassification>,
    ): ItemTypeAndAccountClassification['items'][number] => ({
      accountCode: item.accountCode ?? null,
      accountName: item.accountName ?? null,
      productCode: item.productCode ?? null,
      productName: item.productName ?? null,
      confidence: 100,
    });

    if (itemConfig?.itemType === 'Product' && itemConfig.productCode) {
      return {
        itemType: 'Product',
        accountCode: null,
        accountName: null,
        productCode: itemConfig.productCode,
        productName: itemConfig.productName,
        confidence: 100,
        items: payload.items.map(() =>
          historyLine({
            productCode: itemConfig.productCode,
            productName: itemConfig.productName,
          }),
        ),
      };
    }

    if (itemConfig?.itemType === 'Account' && itemConfig.accountCode) {
      return {
        itemType: 'Account',
        accountCode: itemConfig.accountCode,
        accountName: itemConfig.accountName,
        productCode: null,
        productName: null,
        confidence: 100,
        items: payload.items.map(() =>
          historyLine({
            accountCode: itemConfig.accountCode,
            accountName: itemConfig.accountName,
          }),
        ),
      };
    }

    const supplierDocumentType = payload.supplier.documentType?.trim() || 'NIT';
    const items: ItemTypeAndAccountClassification['items'] = [];

    for (const item of payload.items) {
      const itemMapping =
        await this.supplierItemAccountMappingsRepository.findOneByKey(
          companyId,
          integrationId,
          supplierDocumentType,
          supplierNit,
          item.descripcion,
        );
      const resolved = resolveSuggestedAccountForItem(
        itemMapping,
        configuration,
      );
      if (!resolved || resolved.source !== 'exact') {
        return null;
      }
      items.push(
        historyLine({
          accountCode: resolved.code,
          accountName: resolved.name,
        }),
      );
    }

    if (items.length === 0) {
      return null;
    }

    return {
      itemType: 'Account',
      accountCode: items[0].accountCode,
      accountName: items[0].accountName,
      productCode: null,
      productName: null,
      confidence: 100,
      items,
    };
  }
}
