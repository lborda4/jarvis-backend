import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CompaniesRepository } from '../company/repositories/companies.repository';
import {
  buildSupplierNameLookup,
  indexSupplierConfigurations,
  resolveSuggestedAccountForDocument,
  SuggestedAccount,
} from '../integration/helpers/supplier-accounts-catalog.helper';
import {
  normalizeSupplierNit,
  resolveImportedSupplierName,
} from '../integration/helpers/supplier-name-resolution.helper';
import {
  resolveSuggestedCostCenterForDocument,
  resolveSuggestedPaymentMethodForDocument,
  resolveSuggestedRetentionsForDocument,
} from '../integration/helpers/supplier-preferences.helper';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../integration/interfaces/supplier-mapping-value.interface';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../integration/repositories/supplier-configurations.repository';
import { getSiigoIntegration } from '../integration/siigo/helpers/siigo-context.helper';
import { DianInvoiceResult } from '../dian/interfaces/dian-invoice-result.interface';
import { ElectronicDocumentListQueryDto } from './dto/electronic-document-list-query.dto';
import { ElectronicDocumentListResponseDto } from './dto/electronic-document-list-response.dto';
import { ElectronicDocumentFilterOptionsDto } from './dto/electronic-document-filter-options.dto';
import { ElectronicDocumentCompanyOptionDto } from './dto/electronic-document-company-option.dto';
import { ElectronicDocument } from './entities/electronic-document.entity';
import { ElectronicDocumentProcessingStatus } from './enums/electronic-document-processing-status.enum';
import { ElectronicDocumentStatus } from './enums/electronic-document-status.enum';
import { ElectronicDocumentType } from './enums/electronic-document-type.enum';
import { mapDianResultToElectronicDocumentPayload } from './mappers/dian-to-electronic-document-payload.mapper';
import { GroupedSupportDocument } from './interfaces/support-document-import.interface';
import { mapGroupedSupportDocumentToPayload } from './mappers/support-document-excel-to-payload.mapper';
import { mapElectronicDocumentToListItem } from './mappers/electronic-document-list-item.mapper';
import { parseOptionalElectronicDocumentTypeFilter } from './helpers/electronic-document-type.helper';
import { normalizeElectronicDocumentPageLimit } from './constants/electronic-document-pagination.constants';
import { parseImportStatusFilters } from './helpers/import-status-filter.helper';
import { ElectronicDocumentsRepository } from './repositories/electronic-documents.repository';

@Injectable()
export class ElectronicDocumentService {
  private readonly logger = new Logger(ElectronicDocumentService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly electronicDocumentsRepository: ElectronicDocumentsRepository,
    private readonly companiesRepository: CompaniesRepository,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
  ) {}

  async requireById(
    documentId: string,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const trimmedId = documentId?.trim();

    if (!trimmedId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    const document = await this.electronicDocumentsRepository.findById(trimmedId);

    if (!document) {
      throw new BadRequestException(
        `No se encontró un documento electrónico con id ${trimmedId}.`,
      );
    }

    if (companyId?.trim() && document.companyId !== companyId.trim()) {
      throw new ForbiddenException(
        'El documento no pertenece a la empresa activa del usuario.',
      );
    }

    return document;
  }

  async updateStatus(
    documentId: string,
    status: ElectronicDocumentStatus,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.status = status;

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Documento electrónico actualizado (id=${updated.id}, status=${updated.status})`,
    );

    return updated;
  }

  async updatePayload(
    documentId: string,
    payload: ElectronicDocument['payload'],
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.payload = payload;

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Payload del documento electrónico actualizado (id=${updated.id})`,
    );

    return updated;
  }

  async updatePayloadAndStatus(
    documentId: string,
    payload: ElectronicDocument['payload'],
    status: ElectronicDocumentStatus,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.payload = payload;
    document.status = status;

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Documento electrónico actualizado (id=${updated.id}, status=${updated.status})`,
    );

    return updated;
  }

  async updateProcessingMetadata(
    documentId: string,
    metadata: Partial<{
      supplierExistsInSiigo: boolean | null;
      processingStatus: ElectronicDocumentProcessingStatus;
    }>,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);

    if (metadata.supplierExistsInSiigo !== undefined) {
      document.supplierExistsInSiigo = metadata.supplierExistsInSiigo;
    }

    if (metadata.processingStatus !== undefined) {
      document.processingStatus = metadata.processingStatus;
    }

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Metadatos de procesamiento actualizados (id=${updated.id}, processingStatus=${updated.processingStatus}, supplierExistsInSiigo=${updated.supplierExistsInSiigo})`,
    );

    return updated;
  }

  async markPurchaseCreated(
    documentId: string,
    siigoPurchaseId: string,
    companyId?: string,
    siigoDocumentNumber?: number | null,
    payload?: ElectronicDocument['payload'],
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.status = ElectronicDocumentStatus.PURCHASE_CREATED;
    document.siigoPurchaseId = siigoPurchaseId;
    document.siigoDocumentNumber =
      siigoDocumentNumber === undefined ? document.siigoDocumentNumber : siigoDocumentNumber;

    if (payload !== undefined) {
      document.payload = payload;
    }

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Factura de compra registrada (id=${updated.id}, siigoPurchaseId=${updated.siigoPurchaseId}, siigoDocumentNumber=${updated.siigoDocumentNumber ?? 'null'})`,
    );

    return updated;
  }

  async clearPurchaseCreated(
    documentId: string,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.status = ElectronicDocumentStatus.ACCOUNT_MAPPED;
    document.siigoPurchaseId = null;
    document.siigoDocumentNumber = null;

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Creación en SIIGO revertida (id=${updated.id}, status=${updated.status})`,
    );

    return updated;
  }

  async createFromParsedInvoice(
    parsedInvoice: DianInvoiceResult,
    electronicDocumentType: ElectronicDocumentType,
    authenticatedCompanyId: string,
  ): Promise<ElectronicDocument> {
    const payload = mapDianResultToElectronicDocumentPayload(parsedInvoice);
    const company = await this.companiesRepository.findById(
      authenticatedCompanyId.trim(),
    );

    if (!company) {
      throw new BadRequestException(
        `No se encontró la empresa activa con id ${authenticatedCompanyId}.`,
      );
    }

    const companyNit = this.normalizeDocument(company.nit);
    const receptorNit = this.normalizeDocument(parsedInvoice.receptor.nit);

    if (!receptorNit) {
      throw new BadRequestException(
        'La factura no contiene un NIT de receptor válido.',
      );
    }

    if (companyNit !== receptorNit) {
      throw new BadRequestException(
        `El NIT receptor de la factura (${receptorNit}) no coincide con la empresa activa (${companyNit}).`,
      );
    }

    const documentNumberThird = this.normalizeDocument(
      payload.supplier.documentNumber,
    );

    const electronicDocument = this.electronicDocumentsRepository.create({
      companyId: company.id,
      cufe: payload.invoice.cufe || null,
      documentNumberThird: documentNumberThird || null,
      documentTypeThird: payload.supplier.documentType,
      electronicDocumentType,
      status: ElectronicDocumentStatus.PENDING,
      processingStatus: ElectronicDocumentProcessingStatus.PENDING,
      supplierExistsInSiigo: null,
      payload,
    });

    const saved = await this.electronicDocumentsRepository.save(
      electronicDocument,
    );

    this.logger.log(
      `Documento electrónico persistido (id=${saved.id}, type=${saved.electronicDocumentType}, cufe=${saved.cufe}, companyId=${saved.companyId}, supplierCountry=${saved.payload.supplier.countryCode}, supplierState=${saved.payload.supplier.stateCode}, supplierCity=${saved.payload.supplier.cityCode})`,
    );

    return saved;
  }

  async buildSupplierNameLookupForGroups(
    groups: GroupedSupportDocument[],
    companyId: string,
  ): Promise<Map<string, string>> {
    const company = await this.resolveCompanyForSupportDocuments(
      groups,
      companyId,
    );
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      company.id,
    );
    const configurations =
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        company.id,
        integration.id,
      );

    return buildSupplierNameLookup(configurations);
  }

  async createFromSupportDocumentGroups(
    groups: GroupedSupportDocument[],
    companyId: string,
  ): Promise<{
    documentsCreated: number;
    itemsTotal: number;
    documentIds: string[];
  }> {
    if (!groups.length) {
      throw new BadRequestException(
        'No se encontraron Documentos Soporte para importar.',
      );
    }

    const company = await this.resolveCompanyForSupportDocuments(
      groups,
      companyId,
    );
    const supplierNamesByNit = buildSupplierNameLookup(
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        company.id,
        (await getSiigoIntegration(this.integrationsRepository, company.id)).id,
      ),
    );
    const documents = groups.map((group) => {
      const payload = mapGroupedSupportDocumentToPayload(group);
      const supplierNit = normalizeSupplierNit(payload.supplier.documentNumber);
      const supplierName = resolveImportedSupplierName(
        supplierNit,
        group.supplierName,
        supplierNamesByNit,
      );

      payload.supplier.name = supplierName;
      payload.supplier.commercialName = supplierName;

      return this.electronicDocumentsRepository.create({
        companyId: company.id,
        cufe: payload.invoice.cufe || null,
        documentNumberThird:
          this.normalizeDocument(payload.supplier.documentNumber) || null,
        documentTypeThird: payload.supplier.documentType,
        electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
        status: ElectronicDocumentStatus.PENDING,
        processingStatus: ElectronicDocumentProcessingStatus.PENDING,
        supplierExistsInSiigo: null,
        payload,
      });
    });

    const savedDocuments = await this.dataSource.transaction(async (manager) => {
      return manager.save(ElectronicDocument, documents);
    });

    const itemsTotal = groups.reduce(
      (total, group) => total + group.rows.length,
      0,
    );

    this.logger.log(
      `[companyId=${company.id}] Documentos Soporte importados: documents=${savedDocuments.length}, items=${itemsTotal}`,
    );

    return {
      documentsCreated: savedDocuments.length,
      itemsTotal,
      documentIds: savedDocuments.map((document) => document.id),
    };
  }

  private async resolveCompanyForSupportDocuments(
    groups: GroupedSupportDocument[],
    companyId: string,
  ) {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const company = await this.companiesRepository.findById(trimmedCompanyId);

    if (!company) {
      throw new BadRequestException(
        `No se encontró la empresa con id ${trimmedCompanyId}.`,
      );
    }

    const receiverIdentification = groups
      .map((group) => group.receiverIdentification?.trim())
      .find(Boolean);

    if (receiverIdentification) {
      const normalizedReceiver = this.normalizeDocument(receiverIdentification);
      const companyNit = this.normalizeDocument(company.nit);

      if (normalizedReceiver !== companyNit) {
        throw new BadRequestException(
          `El NIT receptor del Excel (${normalizedReceiver}) no coincide con la empresa activa (${companyNit}).`,
        );
      }
    }

    return company;
  }

  async listDocuments(
    query: ElectronicDocumentListQueryDto,
    companyId: string,
  ): Promise<ElectronicDocumentListResponseDto> {
    const page = Math.max(Number.parseInt(query.page ?? '1', 10) || 1, 1);
    const limit = normalizeElectronicDocumentPageLimit(query.limit);

    const dateFrom = query.dateFrom?.trim()
      ? new Date(`${query.dateFrom.trim()}T00:00:00.000Z`)
      : undefined;
    const dateTo = query.dateTo?.trim()
      ? new Date(`${query.dateTo.trim()}T23:59:59.999Z`)
      : undefined;

    const electronicDocumentType = parseOptionalElectronicDocumentTypeFilter(
      query.electronicDocumentType,
    );
    const supplierNits = query.supplierNits
      ?.split(',')
      .map((nit) => nit.trim())
      .filter(Boolean);
    const issueDates = query.issueDates
      ?.split(',')
      .map((date) => date.trim())
      .filter(Boolean);
    const siigoDocumentNumbers = query.siigoDocumentNumbers
      ?.split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    const importStatuses = parseImportStatusFilters(query.importStatuses);

    const { items, total } = await this.electronicDocumentsRepository.findAll({
      electronicDocumentType,
      status: query.status,
      companyId,
      dateFrom,
      dateTo,
      search: query.search,
      supplierNits,
      issueDates,
      siigoDocumentNumbers,
      importStatuses,
      page,
      limit,
    });

    const supplierPreferences = await this.buildSupplierPreferencesLookup(items);

    return {
      items: items.map((document) =>
        mapElectronicDocumentToListItem(
          document,
          supplierPreferences.accounts.get(document.id) ?? null,
          supplierPreferences.paymentMethods.get(document.id) ?? null,
          supplierPreferences.retentions.get(document.id) ?? [],
          supplierPreferences.costCenters.get(document.id) ?? null,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  async getFilterOptions(
    companyId: string,
    electronicDocumentType?: string,
  ): Promise<ElectronicDocumentFilterOptionsDto> {
    const parsedType = parseOptionalElectronicDocumentTypeFilter(
      electronicDocumentType,
    );

    return this.electronicDocumentsRepository.findFilterOptions(
      companyId,
      parsedType,
    );
  }

  private async buildSupplierPreferencesLookup(
    documents: ElectronicDocument[],
  ): Promise<{
    accounts: Map<string, SuggestedAccount | null>;
    paymentMethods: Map<string, SupplierPaymentMethodPreference | null>;
    retentions: Map<string, SupplierRetentionPreference[]>;
    costCenters: Map<string, SupplierCostCenterPreference | null>;
  }> {
    const accounts = new Map<string, SuggestedAccount | null>();
    const paymentMethods = new Map<string, SupplierPaymentMethodPreference | null>();
    const retentions = new Map<string, SupplierRetentionPreference[]>();
    const costCenters = new Map<string, SupplierCostCenterPreference | null>();

    if (!documents.length) {
      return { accounts, paymentMethods, retentions, costCenters };
    }

    const configurationIndex = new Map<
      string,
      Awaited<
        ReturnType<SupplierConfigurationsRepository['findByCompanyAndIntegration']>
      >[number]
    >();
    const integrationIdByCompanyId = new Map<string, string>();
    const companyIds = [...new Set(documents.map((document) => document.companyId))];

    for (const companyId of companyIds) {
      const integration = await getSiigoIntegration(
        this.integrationsRepository,
        companyId,
      );
      integrationIdByCompanyId.set(companyId, integration.id);

      const configurations =
        await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
          companyId,
          integration.id,
        );

      for (const [key, configuration] of indexSupplierConfigurations(
        configurations,
      )) {
        configurationIndex.set(key, configuration);
      }
    }

    for (const document of documents) {
      const integrationId = integrationIdByCompanyId.get(document.companyId);

      if (!integrationId) {
        accounts.set(document.id, null);
        paymentMethods.set(document.id, null);
        retentions.set(document.id, []);
        costCenters.set(document.id, null);
        continue;
      }

      accounts.set(
        document.id,
        resolveSuggestedAccountForDocument(
          document,
          configurationIndex,
          integrationId,
        ),
      );
      paymentMethods.set(
        document.id,
        resolveSuggestedPaymentMethodForDocument(
          document,
          configurationIndex,
          integrationId,
        ),
      );
      retentions.set(
        document.id,
        resolveSuggestedRetentionsForDocument(
          document,
          configurationIndex,
          integrationId,
        ),
      );
      costCenters.set(
        document.id,
        resolveSuggestedCostCenterForDocument(
          document,
          configurationIndex,
          integrationId,
        ),
      );
    }

    return { accounts, paymentMethods, retentions, costCenters };
  }

  async listCompanyOptions(
    companyId: string,
  ): Promise<ElectronicDocumentCompanyOptionDto[]> {
    const company = await this.companiesRepository.findById(companyId.trim());

    if (!company) {
      return [];
    }

    return [
      {
        id: company.id,
        name: company.name,
        nit: company.nit,
      },
    ];
  }

  private normalizeDocument(identification: string): string {
    return identification.replace(/[^\d]/g, '');
  }
}
