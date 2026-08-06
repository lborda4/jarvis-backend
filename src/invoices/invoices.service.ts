import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
import { ElectronicDocumentType } from '../electronic-document/enums/electronic-document-type.enum';
import { parseElectronicDocumentType } from '../electronic-document/helpers/electronic-document-type.helper';
import { ElectronicDocumentService } from '../electronic-document/electronic-document.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { JarvisDocumentPreparationService } from '../integration/jarvis/jarvis-document-preparation.service';
import { SiigoDocumentPreparationService } from '../integration/siigo/siigo-document-preparation.service';
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
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
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
    await this.assertSupplierNamesForProvider(groups, companyId);
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
    await this.assertSupplierNamesForProvider(groups, companyId);
    applySupportDocumentIssueDate(groups, request?.issueDate);
    const processedRows = groups.reduce(
      (total, group) => total + group.rows.length,
      0,
    );

    this.logger.log(
      `Documentos Soporte detectados: groups=${groups.length}, rows=${processedRows}`,
    );

    const result = await this.electronicDocumentService.createFromSupportDocumentGroups(
      groups,
      companyId ?? '',
    );

    const supplierNamesByNit =
      await this.electronicDocumentService.buildSupplierNameLookupForGroups(
        groups,
        companyId ?? '',
      );
    const records = groups.map((group, index) =>
      mapGroupedSupportDocumentToPreview(
        group,
        result.documentIds[index] ?? group.groupKey,
        supplierNamesByNit,
      ),
    );

    this.logger.log(
      `Documentos Soporte guardados: documentsCreated=${result.documentsCreated}, itemsTotal=${result.itemsTotal}`,
    );

    const resolvedCompanyId = companyId?.trim();
    if (resolvedCompanyId && result.documentIds.length > 0) {
      const provider =
        await this.electronicDocumentService.resolveDocumentProvider(
          resolvedCompanyId,
        );

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

      console.log('[XML import] factura de compra almacenada', {
        rquid,
        electronicDocumentId: electronicDocument.id,
        electronicDocumentType,
        buyerNit: parsedData.receptor.nit,
        vendorNit: parsedData.emisor.nit,
      });

      this.logger.log(
        `[rquid=${rquid}] XML procesado (buyerNit=${parsedData.receptor.nit}, vendorNit=${parsedData.emisor.nit})`,
      );

      const resolvedCompanyId = companyId?.trim();
      if (resolvedCompanyId) {
        this.siigoDocumentPreparationService.prepareDocumentsInBackground(
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
      console.error(error);

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

  getSupportDocumentTemplate(provider?: string): {
    buffer: Buffer;
    filename: string;
  } {
    const includeSupplierName =
      provider?.trim().toUpperCase() !== IntegrationProvider.JARVIS;

    return {
      buffer: buildSupportDocumentTemplateExcel(includeSupplierName),
      filename: SUPPORT_DOCUMENT_TEMPLATE_FILENAME,
    };
  }

  private async assertSupplierNamesForProvider(
    groups: ReturnType<typeof parseSupportDocumentExcel>,
    companyId?: string,
  ): Promise<void> {
    const resolvedCompanyId = companyId?.trim();
    if (!resolvedCompanyId) {
      return;
    }

    const provider =
      await this.electronicDocumentService.resolveDocumentProvider(
        resolvedCompanyId,
      );

    if (
      provider !== IntegrationProvider.JARVIS &&
      groups.some((group) => !group.supplierName.trim())
    ) {
      throw new BadRequestException(
        'La columna Nombre tercero es obligatoria para Documento Soporte con SIIGO.',
      );
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'No se pudo procesar el archivo XML.';
  }
}
