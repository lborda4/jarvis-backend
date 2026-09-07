import { Injectable, Logger } from '@nestjs/common';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SupplierItemAccountMappingsRepository } from '../repositories/supplier-item-account-mappings.repository';
import {
  resolveSuggestedAccountForItem,
  resolveSuggestedPaymentMethodFromSync,
} from '../helpers/supplier-preference.helper';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { OpenRouterHttpClient } from '../openrouter/clients/openrouter-http.client';
import { SiigoAiAccountSuggestionService } from './siigo-ai-account-suggestion.service';

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
    void this.classifyDocuments(documentIds, companyId);
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
    } catch {
      console.log(
        `[AI-CLASSIFY] [companyId=${companyId}] Omitido para ${documentIds.join(', ')}: la empresa no tiene integración SIIGO.`,
      );

      // Empresas sin integración SIIGO (p.ej. Jarvis) no usan esta clasificación.
      return;
    }

    this.logger.log(
      `[companyId=${companyId}] Evaluando clasificación automática con IA para ${documentIds.length} documento(s): ${documentIds.join(', ')}`,
    );

    await Promise.all(
      documentIds.map((documentId) =>
        this.classifyOne(documentId, companyId, integrationId).catch(
          (error) => {
            this.logger.error(
              `[documentId=${documentId}] Error en clasificación automática con IA`,
              error instanceof Error ? error.stack : String(error),
            );
          },
        ),
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

    if (!supplierNit) {
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] Omitido: el documento no tiene NIT de proveedor en el payload.`,
      );

      return;
    }

    const configuration =
      await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
        companyId,
        integrationId,
        supplierNit,
      );

    const needsAi = await this.needsAiClassification(
      document.payload,
      configuration,
      companyId,
      integrationId,
      supplierNit,
    );

    // Cuenta ya resuelta con una regla exacta por ítem, y medio de pago fijo
    // por el sync de historial: la preferencia ya sincronizada alcanza, no
    // hace falta gastar una llamada a la IA.
    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] needsAi=${needsAi}`,
    );

    if (!needsAi) {
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] Omitido, NO se llamó a la IA: cuenta y medio de pago ya resueltos con confianza por el historial.`,
      );

      return;
    }

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] ANTES de invocar classifyItemTypeAndAccount — ${new Date().toISOString()}`,
    );

    const classification =
      await this.siigoAiAccountSuggestionService.classifyItemTypeAndAccount(
        documentId,
        companyId,
      );

    console.log(
      `[AI-CLASSIFY] [documentId=${documentId}] DESPUÉS de invocar classifyItemTypeAndAccount — ${new Date().toISOString()} — itemType=${classification.itemType ?? 'null'}, accountCode=${classification.accountCode ?? 'null'}, accountName=${classification.accountName ?? 'null'}, productCode=${classification.productCode ?? 'null'}, productName=${classification.productName ?? 'null'}`,
    );

    if (!classification.accountCode && !classification.productCode) {
      console.log(
        `[AI-CLASSIFY] [documentId=${documentId}] IA no encontró una cuenta contable ni un producto seguros (tipo=${classification.itemType ?? 'desconocido'}); se deja sin sugerencia automática.`,
      );
      return;
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
      {
        ...freshDocument.payload,
        aiSuggestion: {
          // Esta clasificación automática solo pide tipo de ítem + código
          // (ver purchase-item-classification-prompt.helper.ts) — a
          // diferencia del botón manual "Sugerir con IA", no incluye
          // retenciones. Cuenta y producto son mutuamente excluyentes: el
          // itemType decide cuál catálogo consultó la IA.
          account: classification.accountCode
            ? {
                code: classification.accountCode,
                name: classification.accountName ?? classification.accountCode,
              }
            : null,
          product: classification.productCode
            ? {
                code: classification.productCode,
                name: classification.productName ?? classification.productCode,
              }
            : null,
          retentions: [],
        },
      },
      companyId,
    );
  }

  /**
   * true si falta info confiable de cuenta contable (algún ítem sin regla
   * exacta proveedor+descripción) o de medio de pago (sin valor fijo
   * calculado por el sync de historial). "Confiable" acá es el mismo umbral
   * que ya usa todo el producto: VARIABILITY_THRESHOLD=0.7 en
   * SiigoPurchaseHistorySyncService — un campo solo llega marcado
   * `variable: false` (o `configuration.preference` solo se llena) cuando su
   * valor dominante cubre ≥70% del historial de ese proveedor. No se
   * introduce un umbral distinto para la IA: `resolveSuggestedPaymentMethodFromSync`
   * y `resolveSuggestedAccountFromPreference` (el fallback dentro de
   * `resolveSuggestedAccountForItem`) ya leen exactamente esa señal.
   * `source: 'fallback'` (proveedor con una única cuenta en su historial,
   * pero esta descripción de ítem es nueva) sigue disparando la IA aunque ya
   * haya pasado el 70% a nivel proveedor — es una distinción aparte, no de
   * umbral: esa cuenta nunca se validó contra ESTA descripción puntual.
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
}
