import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DianParserService } from '../dian/dian-parser.service';
import {
  extractInvoiceXmlFromZip,
  isZipBuffer,
  looksLikeXmlContent,
  normalizeXmlString,
} from '../dian/helpers/dian-xml.helper';
import {
  InvalidXmlFormatException,
  MissingFileException,
  XmlParserException,
} from '../common/exceptions/excel.exceptions';
import { parseElectronicDocumentType } from '../electronic-document/helpers/electronic-document-type.helper';
import { ElectronicDocumentService } from '../electronic-document/electronic-document.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { JarvisDocumentPreparationService } from '../integration/jarvis/jarvis-document-preparation.service';
import { SiigoDocumentPreparationService } from '../integration/siigo/siigo-document-preparation.service';
import { SiigoPurchaseAiClassificationService } from '../integration/siigo/siigo-purchase-ai-classification.service';
import { ImportSessionService } from '../import-session/import-session.service';
import { ExcelService } from '../common/services/excel.service';
import { ExtractInvoicesResponseDto } from './dto/extract-invoices-response.dto';
import { ParseXmlResponseDto } from './dto/parse-xml-response.dto';
import {
  ExtractSupportDocumentsResponseDto,
  ImportSupportDocumentsRequestDto,
  ImportSupportDocumentsResponseDto,
} from './dto/import-support-documents.dto';
import { UploadXmlRequestDto } from './dto/upload-xml-request.dto';
import { parseSupportDocumentExcel } from './helpers/support-document-excel.helper';
import { parseDianSalesInvoiceExcel } from './helpers/sales-invoice-excel.helper';
import { PurchaseInvoiceImportJobStatus } from './enums/purchase-invoice-import-job-status.enum';
import { PurchaseInvoiceImportJobsRepository } from './repositories/purchase-invoice-import-jobs.repository';
import { PurchaseInvoiceImportJobRowsRepository } from './repositories/purchase-invoice-import-job-rows.repository';
import { PurchaseInvoiceImportStatusService } from './services/purchase-invoice-import-status.service';
import {
  PurchaseInvoiceImportStatusResponseDto,
  StartPurchaseInvoiceImportResponseDto,
} from './dto/purchase-invoice-import-job.dto';
import { PurchaseInvoiceValidationReportDto } from './dto/purchase-invoice-import-validation.dto';
import { validatePurchaseInvoiceExcelRows } from './helpers/purchase-invoice-import-validation.helper';
import { applySupportDocumentIssueDate } from './helpers/support-document-issue-date.helper';
import {
  buildSupportDocumentTemplateExcel,
  SUPPORT_DOCUMENT_TEMPLATE_FILENAME,
} from './helpers/support-document-template.helper';
import { mapDianResultToImportSummary } from './mappers/dian-to-import-summary.mapper';
import {
  buildUniqueFilter,
  mapRowToInvoicePreview,
} from './mappers/invoice-preview.mapper';
import { mapGroupedSupportDocumentToPreview } from './mappers/support-document-preview.mapper';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly excelService: ExcelService,
    private readonly dianParserService: DianParserService,
    private readonly importSessionService: ImportSessionService,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly siigoDocumentPreparationService: SiigoDocumentPreparationService,
    private readonly siigoPurchaseAiClassificationService: SiigoPurchaseAiClassificationService,
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
    private readonly purchaseInvoiceImportJobsRepository: PurchaseInvoiceImportJobsRepository,
    private readonly purchaseInvoiceImportJobRowsRepository: PurchaseInvoiceImportJobRowsRepository,
    private readonly purchaseInvoiceImportStatusService: PurchaseInvoiceImportStatusService,
  ) {}

  async previewSupportDocumentsFromExcel(
    file?: Express.Multer.File,
    companyId?: string,
    request?: ImportSupportDocumentsRequestDto,
  ): Promise<ExtractSupportDocumentsResponseDto> {
    if (!file) {
      throw new MissingFileException();
    }

    this.logger.log(
      `Leyendo vista previa de Documentos Soporte (${file.originalname ?? 'archivo.xlsx'})`,
    );

    const groups = parseSupportDocumentExcel(file.buffer);
    applySupportDocumentIssueDate(groups, request?.issueDate);
    const processedRows = groups.reduce(
      (total, group) => total + group.rows.length,
      0,
    );
    const supplierNamesByNit =
      await this.electronicDocumentService.buildSupplierNameLookupForGroups(
        groups,
        companyId ?? '',
      );
    const records = groups.map((group) =>
      mapGroupedSupportDocumentToPreview(
        group,
        group.groupKey,
        supplierNamesByNit,
      ),
    );

    this.logger.log(
      `Vista previa de Documentos Soporte: groups=${groups.length}, rows=${processedRows}`,
    );

    return {
      processedRows,
      itemsTotal: processedRows,
      total: records.length,
      filters: {
        documentTypes: buildUniqueFilter(records, 'documentType'),
        statuses: buildUniqueFilter(records, 'status'),
      },
      records,
    };
  }

  async extractInvoicesFromExcel(
    file?: Express.Multer.File,
  ): Promise<ExtractInvoicesResponseDto> {
    if (!file) {
      throw new MissingFileException();
    }

    const rows = await this.excelService.readFirstSheet(file.buffer);
    const records = rows.map((row) => mapRowToInvoicePreview(row));

    return this.buildResponse(records);
  }

  async importSupportDocumentsFromExcel(
    file?: Express.Multer.File,
    companyId?: string,
    request?: ImportSupportDocumentsRequestDto,
  ): Promise<ImportSupportDocumentsResponseDto> {
    if (!file) {
      throw new MissingFileException();
    }

    this.logger.log(
      `Iniciando importación de Documentos Soporte (${file.originalname ?? 'archivo.xlsx'})`,
    );

    const groups = parseSupportDocumentExcel(file.buffer);
    applySupportDocumentIssueDate(groups, request?.issueDate);
    const processedRows = groups.reduce(
      (total, group) => total + group.rows.length,
      0,
    );

    this.logger.log(
      `Documentos Soporte detectados: groups=${groups.length}, rows=${processedRows}`,
    );

    const result =
      await this.electronicDocumentService.createFromSupportDocumentGroups(
        groups,
        companyId ?? '',
      );

    const records = groups.map((group, index) =>
      mapGroupedSupportDocumentToPreview(
        group,
        result.documentIds[index] ?? group.groupKey,
        result.supplierNamesByNit,
      ),
    );

    this.logger.log(
      `Documentos Soporte guardados: documentsCreated=${result.documentsCreated}, itemsTotal=${result.itemsTotal}`,
    );

    const resolvedCompanyId = companyId?.trim();
    if (resolvedCompanyId && result.documentIds.length > 0) {
      const provider = result.provider;

      if (provider === IntegrationProvider.JARVIS) {
        this.jarvisDocumentPreparationService.prepareDocumentsInBackground(
          result.documentIds,
          resolvedCompanyId,
        );
      } else {
        this.siigoDocumentPreparationService.prepareDocumentsInBackground(
          result.documentIds,
          resolvedCompanyId,
        );
        this.siigoPurchaseAiClassificationService.classifyDocumentsInBackground(
          result.documentIds,
          resolvedCompanyId,
        );
      }
    }

    return {
      processedRows,
      itemsTotal: result.itemsTotal,
      documentsCreated: result.documentsCreated,
      documentIds: result.documentIds,
      records,
    };
  }

  /**
   * Pasada de validación rápida (sin tocar NextPyme/SIIGO) sobre el Excel:
   * campos faltantes, CUFEs duplicados, formato de NIT. Se llama ANTES de
   * confirmar la importación, para que el usuario pueda revisar el reporte
   * y corregir el archivo si hace falta antes de disparar ninguna llamada
   * real. `importPurchaseInvoicesFromExcel` vuelve a correr esta misma
   * validación por si el archivo cambió entre esta llamada y la
   * confirmación — recién si pasa esa segunda vez se insertan filas.
   */
  async validatePurchaseInvoicesExcel(
    file?: Express.Multer.File,
  ): Promise<PurchaseInvoiceValidationReportDto> {
    if (!file) {
      throw new MissingFileException();
    }

    const { rows } = parseDianSalesInvoiceExcel(file.buffer);

    return validatePurchaseInvoiceExcelRows(rows);
  }

  /**
   * Parsea el Excel (rápido, en memoria) y arranca la importación real en
   * segundo plano — consultar el CUFE de cada fila en NextPyme puede tardar
   * minutos con 500+ filas, más de lo que aguanta cualquier timeout de
   * cliente HTTP. El job arranca en estado "pending" (todavía no se tocó
   * nada); el frontend consulta el progreso/resultado en
   * GET purchase-invoices/import-jobs/:jobId/status en vez de esperar esta
   * respuesta.
   */
  async importPurchaseInvoicesFromExcel(
    file?: Express.Multer.File,
    companyId?: string,
  ): Promise<StartPurchaseInvoiceImportResponseDto> {
    if (!file) {
      throw new MissingFileException();
    }

    this.logger.log(
      `Iniciando importación de Facturas de compra DIAN (${file.originalname ?? 'archivo.xlsx'})`,
    );

    const { processedRows, rows } = parseDianSalesInvoiceExcel(file.buffer);

    this.logger.log(
      `Facturas de compra DIAN: filasLeídas=${processedRows}, facturasRecibidas=${rows.length}`,
    );

    const job = await this.purchaseInvoiceImportJobsRepository.save(
      this.purchaseInvoiceImportJobsRepository.create({
        companyId: companyId ?? '',
        fileName: file.originalname ?? null,
        totalRows: rows.length,
        status: PurchaseInvoiceImportJobStatus.PENDING,
      }),
    );

    // Sin filas para procesar (Excel vacío o sin ninguna fila "Factura
    // electrónica"/"Recibido"): se marca COMPLETED acá mismo, en la misma
    // request, en vez de dejarlo en PENDING a la espera de que el worker en
    // segundo plano lo descubra en su próximo tick. Antes esto quedaba
    // PENDING con 0 filas — el frontend mostraba "0 de 0" mientras esperaba
    // un evento de finalización que dependía de una carrera entre el
    // primer tick del worker y que el socket ya estuviera suscrito a este
    // job, en vez de resolver de inmediato como corresponde cuando
    // literalmente no hay nada que hacer.
    if (rows.length === 0) {
      await this.purchaseInvoiceImportJobsRepository.patch(job.id, {
        status: PurchaseInvoiceImportJobStatus.COMPLETED,
        processedRows: 0,
        completedAt: new Date(),
      });

      return { jobId: job.id, totalRows: 0 };
    }

    // VALIDACIÓN PREVIA: si hay filas inválidas se aborta acá, antes de
    // insertar una sola PurchaseInvoiceImportJobRow — el jobId ya existe así
    // que el frontend puede consultar el motivo por GET .../status igual
    // que si hubiera fallado en segundo plano.
    const validation = validatePurchaseInvoiceExcelRows(rows);

    if (validation.invalidRows > 0) {
      this.logger.warn(
        `Facturas de compra DIAN: ${validation.invalidRows} fila(s) inválida(s) detectada(s) en la validación previa; se aborta el import sin consultar NextPyme/SIIGO.`,
      );

      await this.purchaseInvoiceImportJobsRepository.patch(job.id, {
        status: PurchaseInvoiceImportJobStatus.ERROR,
        errorMessage: `El Excel tiene ${validation.invalidRows} fila(s) inválida(s). Corrígelas y vuelve a importar.`,
        validationReport: validation,
        completedAt: new Date(),
      });

      return { jobId: job.id, totalRows: rows.length };
    }

    // TOLERANCIA A FALLOS: se insertan TODAS las filas como "pending",
    // incluyendo la fila original completa (rawRow) — la tabla misma actúa
    // de cola (ver PurchaseInvoiceImportWorkerService), sin depender de
    // encolar nada explícitamente: el worker descubre este job solo en su
    // próximo tick de polling.
    await this.purchaseInvoiceImportJobRowsRepository.saveMany(
      rows.map((row, index) =>
        this.purchaseInvoiceImportJobRowsRepository.create({
          jobId: job.id,
          rowIndex: index + 1,
          cufe: row.cufe,
          issuerNit: row.issuerNit,
          issuerName: row.issuerName,
          rawRow: row,
        }),
      ),
    );

    return { jobId: job.id, totalRows: rows.length };
  }

  async getPurchaseInvoiceImportJobStatus(
    jobId: string,
    companyId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    return this.purchaseInvoiceImportStatusService.getStatus(jobId, companyId);
  }

  async getLatestPurchaseInvoiceImportStatus(
    companyId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    return this.purchaseInvoiceImportStatusService.getLatestStatus(companyId);
  }

  /**
   * Vuelve a 'pending' solo las filas 'failed' de un job ya terminado
   * (conservan su rawRow) — el worker las recoge solas en su próximo tick,
   * como si fueran las únicas pendientes, sin tocar las que ya están
   * 'success'.
   */
  async retryFailedPurchaseInvoiceImportRows(
    jobId: string,
    companyId: string,
  ): Promise<PurchaseInvoiceImportStatusResponseDto> {
    const job = await this.purchaseInvoiceImportJobsRepository.findById(jobId);

    if (!job || job.companyId !== companyId) {
      return this.purchaseInvoiceImportStatusService.buildEmptyImportStatusResponse();
    }

    if (job.status === PurchaseInvoiceImportJobStatus.RUNNING) {
      throw new ConflictException(
        'El job todavía se está procesando; esperá a que termine antes de reintentar.',
      );
    }

    const resetCount =
      await this.purchaseInvoiceImportJobRowsRepository.resetFailedRowsToPending(
        jobId,
      );

    if (resetCount === 0) {
      throw new BadRequestException(
        'No hay filas fallidas para reintentar en este job.',
      );
    }

    await this.purchaseInvoiceImportJobsRepository.patch(jobId, {
      status: PurchaseInvoiceImportJobStatus.RUNNING,
      errorMessage: null,
      completedAt: null,
    });

    return this.purchaseInvoiceImportStatusService.getStatus(jobId, companyId);
  }

  async extractInvoicesFromXml(
    file?: Express.Multer.File,
    body?: UploadXmlRequestDto,
    companyId?: string,
  ): Promise<ParseXmlResponseDto> {
    if (!file) {
      throw new MissingFileException();
    }

    const electronicDocumentType = parseElectronicDocumentType(
      body?.electronicDocumentType,
    );

    let xmlContent: string;

    try {
      xmlContent = isZipBuffer(file.buffer)
        ? extractInvoiceXmlFromZip(file.buffer)
        : normalizeXmlString(file.buffer.toString('utf8'));
    } catch (error) {
      throw new InvalidXmlFormatException(this.getErrorMessage(error));
    }

    if (!xmlContent) {
      throw new InvalidXmlFormatException('El archivo XML está vacío.');
    }

    if (!looksLikeXmlContent(xmlContent)) {
      throw new InvalidXmlFormatException(
        'El contenido del archivo no parece ser un XML válido. Si subió un ZIP de la DIAN, verifique que contenga la factura.',
      );
    }

    try {
      const parsedData = this.dianParserService.parseInvoiceXml(xmlContent);
      const electronicDocument =
        await this.electronicDocumentService.createFromParsedInvoice(
          parsedData,
          electronicDocumentType,
          companyId ?? '',
        );
      const session = await this.importSessionService.createSession(
        parsedData,
        {
          electronicDocumentId: electronicDocument.id,
          companyId: electronicDocument.companyId,
        },
      );
      const rquid = session.rquid;

      this.logger.log(
        `[rquid=${rquid}] XML procesado (buyerNit=${parsedData.receptor.nit}, vendorNit=${parsedData.emisor.nit})`,
      );

      const resolvedCompanyId = companyId?.trim();
      if (resolvedCompanyId) {
        this.siigoDocumentPreparationService.prepareDocumentsInBackground(
          [electronicDocument.id],
          resolvedCompanyId,
        );
        this.siigoPurchaseAiClassificationService.classifyDocumentsInBackground(
          [electronicDocument.id],
          resolvedCompanyId,
        );
      }

      return {
        success: true,
        id: electronicDocument.id,
        rquid,
        summary: mapDianResultToImportSummary(parsedData),
      };
    } catch (error) {
      this.logger.error(
        'Error al parsear XML de factura',
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof InvalidXmlFormatException) {
        throw error;
      }

      const detail = this.getErrorMessage(error);

      if (this.isInvalidXmlParserError(detail)) {
        throw new InvalidXmlFormatException(detail);
      }

      throw new XmlParserException(detail);
    }
  }

  private isInvalidXmlParserError(detail: string): boolean {
    return (
      detail.includes('ApplicationResponse') ||
      detail.includes('AttachedDocument sin una factura') ||
      detail.includes('elemento raíz detectado') ||
      detail.includes('No se encontró XML dentro del archivo ZIP')
    );
  }

  private buildResponse(
    records: ExtractInvoicesResponseDto['records'],
  ): ExtractInvoicesResponseDto {
    return {
      total: records.length,
      filters: {
        documentTypes: buildUniqueFilter(records, 'documentType'),
        statuses: buildUniqueFilter(records, 'status'),
      },
      records,
    };
  }

  getSupportDocumentTemplate(): {
    buffer: Buffer;
    filename: string;
  } {
    return {
      buffer: buildSupportDocumentTemplateExcel(),
      filename: SUPPORT_DOCUMENT_TEMPLATE_FILENAME,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'No se pudo procesar el archivo XML.';
  }
}
