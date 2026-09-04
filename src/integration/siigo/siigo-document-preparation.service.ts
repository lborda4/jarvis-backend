import { Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { buildSupplierNameLookup } from '../helpers/supplier-accounts-catalog.helper';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SiigoImportValidationStatus } from './enums/siigo-import-validation-status.enum';
import { DocumentPreparationResult } from './interfaces/document-preparation-result.interface';
import { getSiigoIntegration } from './helpers/siigo-context.helper';
import { SiigoAccountMappingService } from './siigo-account-mapping.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoSupplierCreationService } from './siigo-supplier-creation.service';
import { SiigoValidationService } from './siigo-validation.service';
import { SiigoBatchContext } from './interfaces/siigo-batch-context.interface';

const ACCOUNT_MAPPING_REQUIRED_STATUS = 'ACCOUNT_MAPPING_REQUIRED';
/** Cuántos documentos se preparan contra SIIGO en simultáneo — un import de
 * 500+ filas no debe disparar 500+ llamadas paralelas (rate limit de SIIGO).
 * Mismo valor que SYNC_PAGE_FETCH_CONCURRENCY en el sync de historial. */
export const SIIGO_DOCUMENT_PREPARATION_CONCURRENCY = 5;
/** Techo de líneas de progreso logueadas por lote, sin importar el tamaño
 * (un import de 50 filas loguea cada ~3; uno de 5000 loguea cada ~250). */
const MAX_PROGRESS_LOG_LINES = 20;

@Injectable()
export class SiigoDocumentPreparationService {
  private readonly logger = new Logger(SiigoDocumentPreparationService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoValidationService: SiigoValidationService,
    private readonly siigoAccountMappingService: SiigoAccountMappingService,
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupplierCreationService: SiigoSupplierCreationService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
  ) {}

  prepareDocumentsInBackground(documentIds: string[], companyId: string): void {
    void this.prepareDocuments(documentIds, companyId);
  }

  async prepareDocuments(
    documentIds: string[],
    companyId: string,
  ): Promise<void> {
    const batchContext = await this.createBatchContext(companyId);
    const total = documentIds.length;
    // Log cada ~total/20 documentos (mínimo 1) — como máximo ~20 líneas de
    // progreso por lote, sin importar si son 50 o 5000 documentos.
    const progressLogInterval = Math.max(
      1,
      Math.ceil(total / MAX_PROGRESS_LOG_LINES),
    );
    let processedCount = 0;

    this.logger.log(
      `[companyId=${companyId}] Preparación en segundo plano: iniciando ${total} documento(s) con concurrencia ${SIIGO_DOCUMENT_PREPARATION_CONCURRENCY}.`,
    );

    // mapWithConcurrency (no Promise.all sin límite): un import de 500+
    // filas no debe disparar 500+ llamadas paralelas contra SIIGO. Un fallo
    // puntual no bloquea al resto de documentos del lote.
    await mapWithConcurrency(
      documentIds,
      SIIGO_DOCUMENT_PREPARATION_CONCURRENCY,
      async (documentId) => {
        try {
          await this.prepareSupplierAndAccounts(
            documentId,
            companyId,
            batchContext,
          );
        } catch (error) {
          this.logger.error(
            `[documentId=${documentId}] Error en preparación en segundo plano`,
            error instanceof Error ? error.stack : String(error),
          );
          // Antes esto solo quedaba logueado y el documento se quedaba
          // congelado en su estado anterior ("EN PROCESO" para siempre en
          // la UI, sin ningún error visible ni forma de reintentar) — ver
          // markPreparationFailed.
          await this.markPreparationFailed(documentId, companyId);
        } finally {
          processedCount += 1;

          if (
            processedCount % progressLogInterval === 0 ||
            processedCount === total
          ) {
            this.logger.log(
              `[companyId=${companyId}] Preparación en segundo plano: ${processedCount}/${total} documento(s) procesados.`,
            );
          }
        }
      },
    );
  }

  async prepareSupplierAndAccounts(
    documentId: string,
    companyId: string,
    batchContext?: SiigoBatchContext,
  ): Promise<DocumentPreparationResult> {
    const trimmedId = documentId.trim();
    let document = await this.electronicDocumentService.requireById(
      trimmedId,
      companyId,
    );

    // Chequeo de "¿ya existe en SIIGO?" ANTES de validar proveedor/cuenta —
    // el chequeo que se hace al importar (createFromPurchaseInvoiceRows) es
    // solo una foto del momento de importar; si el sync de historial de
    // compras trae esta factura recién DESPUÉS (import y sync no están
    // sincronizados entre sí), sin este segundo chequeo el documento
    // seguiría de largo validando proveedor y cuenta, arriesgándose a
    // terminar creándola duplicada en SIIGO si el usuario llega a "Enviar".
    if (document.status !== ElectronicDocumentStatus.PURCHASE_CREATED) {
      const alreadyInSiigo =
        await this.electronicDocumentService.resolveAlreadyInSiigoMatch(
          document,
          companyId,
        );

      if (alreadyInSiigo) {
        document = await this.electronicDocumentService.markPurchaseCreated(
          trimmedId,
          alreadyInSiigo.facturaId,
          companyId,
          alreadyInSiigo.siigoNumero,
        );

        this.logger.log(
          `[documentId=${trimmedId}] Factura ya existía en SIIGO (detectada por provider_invoice) — marcada como lista sin validar proveedor ni cuenta.`,
        );

        return {
          documentId: trimmedId,
          nextStep: 'READY',
        };
      }
    }

    if (document.supplierExistsInSiigo !== true) {
      const validation = await this.siigoValidationService.validateImport(
        {
          documentId: trimmedId,
        },
        companyId,
        batchContext,
        // No marcar SUPPLIER_NOT_FOUND todavía: primero se intenta crear el
        // tercero automático más abajo.
        { skipNotFoundStatusWrite: true },
      );

      if (
        validation.status === SiigoImportValidationStatus.THIRD_PARTY_REQUIRED
      ) {
        const supplierNit = resolveSupplierDocumentFromPayload(
          document.payload,
        ).normalizedDocumentNumber;
        const autoCreated = await this.tryAutoCreateSupplier(
          trimmedId,
          companyId,
          supplierNit,
          batchContext,
        );

        if (!autoCreated) {
          await this.electronicDocumentService.updateStatus(
            trimmedId,
            ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
            companyId,
          );
          await this.electronicDocumentService.updateSupplierExistsInSiigo(
            trimmedId,
            false,
            companyId,
          );

          return {
            documentId: trimmedId,
            nextStep: 'SUPPLIER_REQUIRED',
          };
        }
      }

      document = await this.electronicDocumentService.requireById(
        trimmedId,
        companyId,
      );
    }

    if (this.isAccountMappingComplete(document.status)) {
      return {
        documentId: trimmedId,
        nextStep: 'READY',
      };
    }

    const accountResult =
      await this.siigoAccountMappingService.validateAccountMapping(
        {
          documentId: trimmedId,
        },
        companyId,
      );

    if (accountResult.status === ACCOUNT_MAPPING_REQUIRED_STATUS) {
      await this.electronicDocumentService.updateStatus(
        trimmedId,
        ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        companyId,
      );

      return {
        documentId: trimmedId,
        nextStep: 'ACCOUNT_REQUIRED',
      };
    }

    return {
      documentId: trimmedId,
      nextStep: 'READY',
    };
  }

  /**
   * Crea el tercero en SIIGO automáticamente cuando no existe, en vez de
   * dejarlo esperando el botón manual "Crear tercero". Usa lo que ya
   * tenemos del documento (NIT, nombre, tipo de documento); la ciudad cae
   * al default de la empresa y la dirección a "0000" si la factura no la
   * trae (ver buildAddress en el mapper). Si falla (NIT inválido, error de
   * SIIGO, etc.) se cae al flujo manual de siempre — no se bloquea nada.
   *
   * Varias facturas del mismo proveedor nuevo pueden procesarse en
   * paralelo dentro del mismo lote — se serializa por NIT (en vez de
   * dejar que cada una intente crear el tercero a la vez) para no crear
   * duplicados en SIIGO. createSupplier ya reutiliza el tercero si otra
   * fila del lote lo acaba de crear, así que cada documento sigue
   * quedando correctamente resuelto con su propio documentId.
   */
  private async tryAutoCreateSupplier(
    documentId: string,
    companyId: string,
    supplierNit: string,
    batchContext?: SiigoBatchContext,
  ): Promise<boolean> {
    const previousAttempt =
      batchContext?.supplierCreationInFlight?.get(supplierNit);

    if (previousAttempt) {
      await previousAttempt.catch(() => undefined);
    }

    const attempt = this.createSupplierOnce(documentId, companyId);
    batchContext?.supplierCreationInFlight?.set(supplierNit, attempt);

    return attempt;
  }

  private async createSupplierOnce(
    documentId: string,
    companyId: string,
  ): Promise<boolean> {
    try {
      await this.siigoSupplierCreationService.createSupplier(
        { documentId },
        companyId,
        'automatic',
      );

      return true;
    } catch (error) {
      this.logger.warn(
        `[documentId=${documentId}] No se pudo crear el tercero automáticamente; queda pendiente de creación manual: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return false;
    }
  }

  private async createBatchContext(
    companyId: string,
  ): Promise<SiigoBatchContext> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const configurations =
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      );

    return {
      authContext: await this.siigoAuthService.getValidAuthContext(companyId),
      localSupplierNamesByNit: buildSupplierNameLookup(configurations),
      supplierByNit: new Map(),
      supplierRequestsInFlight: new Map(),
      supplierCreationInFlight: new Map(),
    };
  }

  /**
   * Marca el documento como FAILED cuando su preparación revienta con una
   * excepción — así queda visible (acción "Reintentar" en el dashboard) en
   * vez de congelado en su estado anterior sin ningún indicio de error. No
   * debe volver a lanzar: si esta actualización también falla, el
   * documento sigue en su estado previo pero el resto del lote (los demás
   * documentos de este worker de mapWithConcurrency) no debe verse
   * afectado.
   */
  private async markPreparationFailed(
    documentId: string,
    companyId: string,
  ): Promise<void> {
    try {
      await this.electronicDocumentService.updateStatus(
        documentId,
        ElectronicDocumentStatus.FAILED,
        companyId,
      );
    } catch (updateError) {
      this.logger.error(
        `[documentId=${documentId}] No se pudo marcar el documento como FAILED tras el error de preparación`,
        updateError instanceof Error ? updateError.stack : String(updateError),
      );
    }
  }

  private isAccountMappingComplete(status: ElectronicDocumentStatus): boolean {
    return (
      status === ElectronicDocumentStatus.ACCOUNT_MAPPED ||
      status === ElectronicDocumentStatus.READY ||
      status === ElectronicDocumentStatus.PURCHASE_CREATED
    );
  }
}
