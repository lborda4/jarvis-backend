import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { mapElectronicDocumentToListItem } from '../../electronic-document/mappers/electronic-document-list-item.mapper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { ResumeElectronicDocumentResponseDto } from '../../electronic-document/dto/resume-electronic-document.dto';
import {
  SiigoDocumentPreparationService,
  SIIGO_DOCUMENT_PREPARATION_CONCURRENCY,
} from './siigo-document-preparation.service';
import { SiigoDocumentCreationService } from './siigo-document-creation.service';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoBatchContext } from './interfaces/siigo-batch-context.interface';

@Injectable()
export class SiigoDocumentResumeService {
  private readonly logger = new Logger(SiigoDocumentResumeService.name);

  constructor(
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoDocumentPreparationService: SiigoDocumentPreparationService,
    private readonly siigoDocumentCreationService: SiigoDocumentCreationService,
    private readonly siigoAuthService: SiigoAuthService,
  ) {}

  /**
   * Dispara resumeBatch de fondo y responde de inmediato — a diferencia de
   * resumeBatch (que el controller usaba directo antes, bloqueando la
   * respuesta HTTP hasta terminar TODO el lote), acá el llamador no espera
   * nada: el progreso real se lee vía polling de GET /electronic-documents,
   * igual que ya hace el frontend (ver watchImportedDocuments). Caso real
   * reportado: un import de 74 documentos hacía que resumeBatch tardara más
   * que el timeout de 30s del cliente HTTP (5 en simultáneo contra la API
   * real de SIIGO, con rate limit) — el request se abortaba del lado del
   * navegador, pero el trabajo seguía corriendo en el server sin que nada
   * lo reflejara, dejando documentos "colgados" hasta la próxima recarga.
   */
  resumeBatchInBackground(
    documentIds: string[],
    companyId: string,
    options?: { prepareOnly?: boolean },
  ): void {
    this.logger.log(
      `[companyId=${companyId}] resumeBatchInBackground iniciado para ${documentIds.length} documento(s).`,
    );

    void this.resumeBatch(documentIds, companyId, options).catch((error) => {
      this.logger.error(
        `[companyId=${companyId}] Error en resumeBatchInBackground`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  /** Devuelve el detalle por documento (a diferencia de
   * ResumeElectronicDocumentsBatchResponseDto, que es solo el ack que
   * recibe el HTTP caller) — resumeBatchInBackground y el spec de este
   * servicio siguen necesitando el resultado real de cada resume(). */
  async resumeBatch(
    documentIds: string[],
    companyId: string,
    options?: { prepareOnly?: boolean },
  ): Promise<{ items: ResumeElectronicDocumentResponseDto[] }> {
    const uniqueIds = [
      ...new Set(
        documentIds.map((documentId) => documentId?.trim()).filter(Boolean),
      ),
    ];

    if (uniqueIds.length === 0) {
      return { items: [] };
    }

    const batchContext = await this.createBatchContext(companyId);
    const prepareOnly = options?.prepareOnly ?? true;
    // mapWithConcurrency (no Promise.all sin límite): reanudar un lote de
    // 50 documentos importados no debe disparar 50 llamadas paralelas
    // contra SIIGO (cada resume() puede terminar consultando el tercero) —
    // mismo límite que usa la preparación en segundo plano del import. Bug
    // real reportado: un import de 50 filas disparaba 50 resume() a la vez
    // desde el frontend, saturando el rate limit de SIIGO y volviendo la
    // validación mucho más lenta de lo normal.
    const items = await mapWithConcurrency(
      uniqueIds,
      SIIGO_DOCUMENT_PREPARATION_CONCURRENCY,
      (documentId) =>
        this.resume(documentId, companyId, batchContext, { prepareOnly }),
    );

    return { items };
  }

  async resume(
    documentId: string,
    companyId: string,
    batchContext?: SiigoBatchContext,
    options?: { prepareOnly?: boolean },
  ): Promise<ResumeElectronicDocumentResponseDto> {
    const trimmedId = documentId?.trim();
    const document = await this.electronicDocumentService.requireById(
      trimmedId,
      companyId,
    );

    if (document.status === ElectronicDocumentStatus.SUPPLIER_NOT_FOUND) {
      return this.buildResponse('SUPPLIER_REQUIRED', document.id, companyId);
    }

    if (
      (document.status === ElectronicDocumentStatus.ACCOUNT_REQUIRED ||
        document.status ===
          ElectronicDocumentStatus.ACCOUNT_MAPPING_REQUIRED) &&
      document.supplierExistsInSiigo === true
    ) {
      return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId);
    }

    if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      return this.buildResponse('COMPLETED', document.id, companyId);
    }

    // Por defecto SOLO prepara (valida proveedor/cuenta) — nunca crea la
    // factura en SIIGO a menos que el llamador pida explícitamente lo
    // contrario (ver comentario más abajo). Se calcula acá, ANTES de tocar
    // el documento, para el chequeo de PURCHASE_FAILED de abajo.
    const prepareOnly = options?.prepareOnly ?? true;

    if (
      document.status === ElectronicDocumentStatus.PURCHASE_FAILED &&
      prepareOnly
    ) {
      // Proveedor y cuenta ya estaban bien (si no, el documento nunca habría
      // llegado a intentar crearse en SIIGO) — volver a correr
      // prepareSupplierAndAccounts acá no reintenta nada de verdad, solo
      // tiene el efecto colateral de limpiar el status de error (vía
      // validateAccountMapping, que sobrescribe el status a ACCOUNT_MAPPED
      // sin importar cuál era antes). Bug real reportado en producción: el
      // botón "Reintentar" (que llama a este resume individual en modo
      // prepareOnly) dejaba estas filas en "Pendiente" sin haber reenviado
      // nada. Si en el futuro se quiere reintentar el envío real, debe
      // llamarse con prepareOnly=false explícito.
      return this.buildResponse('FAILED', document.id, companyId);
    }

    try {
      const preparationResult =
        await this.siigoDocumentPreparationService.prepareSupplierAndAccounts(
          trimmedId,
          companyId,
          batchContext,
        );

      if (preparationResult.nextStep === 'SUPPLIER_REQUIRED') {
        return this.buildResponse('SUPPLIER_REQUIRED', document.id, companyId);
      }

      if (preparationResult.nextStep === 'ACCOUNT_REQUIRED') {
        return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId);
      }

      const refreshedDocument =
        await this.electronicDocumentService.requireById(trimmedId, companyId);
      // Antes esto quedaba habilitado por defecto para el resume
      // individual (a diferencia de resumeBatch, que ya defaultea a
      // prepareOnly=true), y como ESTE resume es justo el que se dispara
      // solo después de importar un Excel, un documento que llegaba con la
      // cuenta ya resuelta (por preferencia guardada o sugerencia de IA) se
      // enviaba a SIIGO sin que el usuario tocara "Enviar".
      const shouldCreateInSiigo =
        !prepareOnly &&
        refreshedDocument.electronicDocumentType !==
          ElectronicDocumentType.SUPPORT_DOCUMENT;

      if (!shouldCreateInSiigo) {
        return this.buildResponse('ACCOUNT_REQUIRED', document.id, companyId);
      }

      await this.siigoDocumentCreationService.createInSiigo(
        trimmedId,
        companyId,
      );

      return this.buildResponse('COMPLETED', document.id, companyId);
    } catch (error) {
      this.logger.error(
        `[documentId=${trimmedId}] Error al reanudar documento`,
        error instanceof Error ? error.stack : String(error),
      );

      const message =
        error instanceof BadGatewayException || error instanceof Error
          ? error.message
          : 'No se pudo reanudar el proceso del documento.';

      const refreshed = await this.electronicDocumentService.requireById(
        trimmedId,
        companyId,
      );

      if (refreshed.status === ElectronicDocumentStatus.SUPPLIER_NOT_FOUND) {
        return this.buildResponse(
          'SUPPLIER_REQUIRED',
          document.id,
          companyId,
          message,
        );
      }

      if (
        refreshed.status === ElectronicDocumentStatus.ACCOUNT_REQUIRED ||
        refreshed.status === ElectronicDocumentStatus.ACCOUNT_MAPPING_REQUIRED
      ) {
        return this.buildResponse(
          'ACCOUNT_REQUIRED',
          document.id,
          companyId,
          message,
        );
      }

      return this.buildResponse('FAILED', document.id, companyId, message);
    }
  }

  private async buildResponse(
    nextStep: ResumeElectronicDocumentResponseDto['nextStep'],
    documentId: string,
    companyId: string,
    message?: string,
  ): Promise<ResumeElectronicDocumentResponseDto> {
    const document = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    return {
      nextStep,
      message,
      document: mapElectronicDocumentToListItem(document),
    };
  }

  private async createBatchContext(
    companyId: string,
  ): Promise<SiigoBatchContext> {
    return {
      authContext: await this.siigoAuthService.getValidAuthContext(companyId),
      localSupplierNamesByNit: new Map(),
      supplierByNit: new Map(),
      supplierRequestsInFlight: new Map(),
    };
  }
}
