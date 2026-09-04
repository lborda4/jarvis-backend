import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withPostgresAdvisoryLock } from '../common/helpers/postgres-advisory-lock.helper';
import { mapWithConcurrency } from '../common/helpers/concurrency.helper';
import { CompaniesRepository } from '../company/repositories/companies.repository';
import {
  buildAccountNameByCode,
  buildSupplierNameLookup,
  indexSupplierConfigurations,
  resolveAccountNameFromCatalog,
  resolveSuggestedAccountForDocument,
  SuggestedAccount,
} from '../integration/helpers/supplier-accounts-catalog.helper';
import { SiigoAccountsRepository } from '../integration/repositories/siigo-accounts.repository';
import {
  normalizeSupplierNit,
  resolveImportedSupplierName,
} from '../integration/helpers/supplier-name-resolution.helper';
import {
  resolveSuggestedAccountsForDocumentItems,
  resolveSuggestedCostCenterForDocument,
  resolveSuggestedItemConfigForDocument,
  resolveSuggestedPaymentMethodForDocument,
  resolveSuggestedProductForDocument,
  resolveSuggestedRetentionsForDocument,
} from '../integration/helpers/supplier-preferences.helper';
import {
  SuggestedItemAccount,
  SuggestedProduct,
  SuggestedPurchaseItemConfig,
} from '../integration/helpers/supplier-preference.helper';
import { indexSupplierItemAccountMappings } from '../integration/helpers/supplier-item-account-mapping.helper';
import { SupplierItemAccountMapping } from '../integration/entities/supplier-item-account-mapping.entity';
import { SupplierItemAccountMappingsRepository } from '../integration/repositories/supplier-item-account-mappings.repository';
import {
  HistorialFacturaProviderInvoiceMatch,
  HistorialFacturasRepository,
} from '../integration/repositories/historial-facturas.repository';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../integration/interfaces/supplier-mapping-value.interface';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { JarvisTercerosRepository } from '../integration/jarvis/repositories/jarvis-terceros.repository';
import { IntegrationsRepository } from '../integration/repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../integration/repositories/supplier-configurations.repository';
import { getSiigoIntegration } from '../integration/siigo/helpers/siigo-context.helper';
import { resolveProviderInvoiceParts } from '../integration/siigo/mappers/electronic-document-to-siigo-purchase.mapper';
import {
  resolveSuggestedTaxForItem,
  SuggestedItemTax,
} from '../integration/siigo/helpers/siigo-item-tax-suggestion.helper';
import { SiigoTaxesCatalogService } from '../integration/siigo/siigo-taxes-catalog.service';
import { SiigoPaymentTypesCatalogService } from '../integration/siigo/siigo-payment-types-catalog.service';
import { SiigoProductsCatalogService } from '../integration/siigo/siigo-products-catalog.service';
import { SiigoProductCatalogItemDto } from '../integration/siigo/dto/list-siigo-products.dto';
import { SiigoPaymentTypeCatalogItemDto } from '../integration/siigo/dto/list-siigo-payment-types.dto';
import { resolveSiigoPaymentDocumentType } from '../integration/siigo/helpers/siigo-payment-document-type.helper';
import { resolveCreditFallbackPaymentMethod } from '../integration/siigo/helpers/siigo-credit-payment-method.helper';
import {
  resolveSuggestedRetentionsFromInvoice,
  isDocumentLevelSupportDocumentRetentionType,
  isItemLevelSupportDocumentRetentionType,
} from '../integration/siigo/helpers/siigo-support-document-retention.helper';
import {
  buildInvoiceSnapshotFromHistorialLines,
  HistorialFacturaInvoiceSnapshot,
} from '../integration/helpers/historial-factura-invoice-snapshot.helper';
import { PlanSubscriptionService } from '../plan/plan-subscription.service';
import { DianInvoiceResult } from '../dian/interfaces/dian-invoice-result.interface';
import { ElectronicDocumentListQueryDto } from './dto/electronic-document-list-query.dto';
import { ElectronicDocumentListResponseDto } from './dto/electronic-document-list-response.dto';
import { ElectronicDocumentFilterOptionsDto } from './dto/electronic-document-filter-options.dto';
import { ElectronicDocumentCompanyOptionDto } from './dto/electronic-document-company-option.dto';
import { ElectronicDocument } from './entities/electronic-document.entity';
import { ElectronicDocumentStatus } from './enums/electronic-document-status.enum';
import { ElectronicDocumentType } from './enums/electronic-document-type.enum';
import { mapDianResultToElectronicDocumentPayload } from './mappers/dian-to-electronic-document-payload.mapper';
import { ElectronicDocumentPayload } from './interfaces/electronic-document-payload.interface';
import { GroupedSupportDocument } from './interfaces/support-document-import.interface';
import { mapGroupedSupportDocumentToPayload } from './mappers/support-document-excel-to-payload.mapper';
import { mapElectronicDocumentToListItem } from './mappers/electronic-document-list-item.mapper';
import { parseOptionalElectronicDocumentTypeFilter } from './helpers/electronic-document-type.helper';
import { normalizeElectronicDocumentPageLimit } from './constants/electronic-document-pagination.constants';
import { parseImportStatusFilters } from './helpers/import-status-filter.helper';
import { resolveSendConfigurationFromPayload } from './helpers/electronic-document-send-configuration.helper';
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
    private readonly supplierItemAccountMappingsRepository: SupplierItemAccountMappingsRepository,
    private readonly historialFacturasRepository: HistorialFacturasRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly planSubscriptionService: PlanSubscriptionService,
    private readonly siigoTaxesCatalogService: SiigoTaxesCatalogService,
    private readonly siigoPaymentTypesCatalogService: SiigoPaymentTypesCatalogService,
    private readonly siigoProductsCatalogService: SiigoProductsCatalogService,
  ) {}

  async requireById(
    documentId: string,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const trimmedId = documentId?.trim();

    if (!trimmedId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    const document =
      await this.electronicDocumentsRepository.findById(trimmedId);

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

    // Un intento tardío de marcar error (ej. el perdedor de una carrera de
    // creación concurrente en SIIGO, ver runExclusiveForDocumentCreation)
    // nunca debe pisar un éxito ya persistido: si el documento ya se creó,
    // la única fuente de verdad de su estado es markPurchaseCreated (o
    // clearPurchaseCreated si se elimina explícitamente) — no un catch que
    // se resuelve después de que otro intento ya tuvo éxito. Bug real en
    // producción: una fila quedaba con status=PURCHASE_FAILED pero con el
    // consecutivo de SIIGO ya asignado.
    if (
      document.status === ElectronicDocumentStatus.PURCHASE_CREATED &&
      status !== ElectronicDocumentStatus.PURCHASE_CREATED
    ) {
      this.logger.warn(
        `Se ignoró un intento de cambiar el status a ${status} en un documento ya creado en SIIGO (id=${documentId}, siigoPurchaseId=${document.siigoPurchaseId}).`,
      );

      return document;
    }

    document.status = status;

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Documento electrónico actualizado (id=${updated.id}, status=${updated.status})`,
    );

    return updated;
  }

  /**
   * Serializa "crear el documento en SIIGO/Jarvis + guardar el resultado"
   * por documento — evita que dos intentos concurrentes para EL MISMO
   * documento (doble clic en "Enviar", o el resume automático corriendo a
   * la vez que un envío manual) llamen ambos al proveedor y se pisen. El
   * segundo intento en tomar el lock relee el estado ya persistido por el
   * primero y aborta ANTES de llamar al proveedor, en vez de arriesgarse a
   * duplicar la factura o (junto con el guard de updateStatus de arriba)
   * sobrescribir un éxito con un error tardío.
   */
  async runExclusiveForDocumentCreation<T>(
    documentId: string,
    companyId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withPostgresAdvisoryLock(
      this.dataSource,
      `document-creation:${documentId}`,
      async () => {
        const document = await this.requireById(documentId, companyId);

        if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
          throw new BadRequestException(
            'El documento ya fue creado en SIIGO para este registro.',
          );
        }

        return fn();
      },
    );
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

  async updateSupplierExistsInSiigo(
    documentId: string,
    supplierExistsInSiigo: boolean | null,
    companyId?: string,
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.supplierExistsInSiigo = supplierExistsInSiigo;

    const updated = await this.electronicDocumentsRepository.save(document);

    this.logger.log(
      `Proveedor SIIGO actualizado (id=${updated.id}, supplierExistsInSiigo=${updated.supplierExistsInSiigo})`,
    );

    return updated;
  }

  /**
   * Otros documentos de la misma empresa y proveedor (mismo NIT) que
   * quedaron en SUPPLIER_NOT_FOUND — usado para propagar la creación de un
   * tercero a todos los documentos pendientes de ese proveedor, no solo al
   * que disparó la creación.
   */
  findSupplierNotFoundSiblings(
    companyId: string,
    documentNumberThird: string,
    excludeId: string,
  ): Promise<ElectronicDocument[]> {
    if (!documentNumberThird.trim()) {
      return Promise.resolve([]);
    }

    return this.electronicDocumentsRepository.findByCompanySupplierAndStatus(
      companyId,
      documentNumberThird.trim(),
      ElectronicDocumentStatus.SUPPLIER_NOT_FOUND,
      excludeId,
    );
  }

  async markPurchaseCreated(
    documentId: string,
    siigoPurchaseId: string,
    companyId?: string,
    siigoDocumentNumber?: string | number | null,
    payload?: ElectronicDocument['payload'],
  ): Promise<ElectronicDocument> {
    const document = await this.requireById(documentId, companyId);
    document.status = ElectronicDocumentStatus.PURCHASE_CREATED;
    document.siigoPurchaseId = siigoPurchaseId;
    document.siigoDocumentNumber =
      siigoDocumentNumber === undefined
        ? document.siigoDocumentNumber
        : siigoDocumentNumber == null
          ? null
          : String(siigoDocumentNumber).trim() || null;

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

  /**
   * Elimina un documento electrónico local que aún no está en estado "lista"
   * (PURCHASE_CREATED). Aplica a Documento soporte y Factura de compra.
   */
  async deleteLocalDocument(
    documentId: string,
    companyId: string,
  ): Promise<void> {
    const document = await this.requireById(documentId, companyId);

    if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
      throw new BadRequestException(
        'No se puede eliminar un documento ya enviado. Solo se pueden borrar registros que no estén en lista.',
      );
    }

    await this.electronicDocumentsRepository.deleteById(document.id);

    this.logger.log(
      `Documento electrónico eliminado de la BD (id=${document.id}, type=${document.electronicDocumentType}, status=${document.status})`,
    );
  }

  /**
   * Variante en lote de deleteLocalDocument — un solo SELECT + un solo
   * DELETE para todo el lote, en vez de 2×N consultas (una por documento).
   * Borrar 100 registros uno por uno desde el dashboard tardaba varios
   * segundos por el overhead de 100 idas y vueltas HTTP+BD; este endpoint
   * lo resuelve en una sola operación.
   */
  async deleteLocalDocuments(
    documentIds: string[],
    companyId: string,
  ): Promise<{ deletedIds: string[]; skippedIds: string[] }> {
    const uniqueIds = [...new Set(documentIds.map((id) => id?.trim()).filter(Boolean))];

    if (uniqueIds.length === 0) {
      return { deletedIds: [], skippedIds: [] };
    }

    const documents = await this.electronicDocumentsRepository.findByCompanyAndIds(
      companyId,
      uniqueIds,
    );
    const documentsById = new Map(documents.map((document) => [document.id, document]));

    const deletableIds: string[] = [];
    const skippedIds: string[] = [];

    for (const id of uniqueIds) {
      const document = documentsById.get(id);

      if (!document || document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
        skippedIds.push(id);
        continue;
      }

      deletableIds.push(id);
    }

    await this.electronicDocumentsRepository.deleteByIds(deletableIds);

    this.logger.log(
      `Documentos electrónicos eliminados de la BD en lote (${deletableIds.length} eliminado(s), ${skippedIds.length} omitido(s)).`,
    );

    return { deletedIds: deletableIds, skippedIds };
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
      supplierExistsInSiigo: null,
      payload,
    });

    const saved =
      await this.electronicDocumentsRepository.save(electronicDocument);

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
    const provider = await this.resolveDocumentProvider(company.id);

    return this.resolveSupplierNamesByNit(company.id, provider);
  }

  /**
   * Serializa "revisar cupo del plan + guardar documentos" por empresa y
   * tipo de documento, para que dos importaciones concurrentes de la misma
   * empresa no puedan pasar ambas el chequeo de límite antes de que
   * cualquiera confirme sus documentos (TOCTOU).
   */
  private async withDocumentQuotaLock<T>(
    companyId: string,
    documentType: ElectronicDocumentType,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withPostgresAdvisoryLock(
      this.dataSource,
      `document-quota:${companyId}:${documentType}`,
      fn,
    );
  }

  async createFromSupportDocumentGroups(
    groups: GroupedSupportDocument[],
    companyId: string,
  ): Promise<{
    documentsCreated: number;
    itemsTotal: number;
    documentIds: string[];
    provider: IntegrationProvider;
    supplierNamesByNit: Map<string, string>;
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
    const provider = await this.resolveDocumentProvider(company.id);

    const { savedDocuments, supplierNamesByNit } =
      await this.withDocumentQuotaLock(
        company.id,
        ElectronicDocumentType.SUPPORT_DOCUMENT,
        async () => {
          // Solo se valida elegibilidad (plan activo, suscripción no
          // suspendida, tipo de documento incluido) — el cupo NUMÉRICO del
          // plan ya no limita cuántos documentos locales se crean acá.
          // Importar el Excel nunca debe descontar nada del plan; eso solo
          // ocurre al ENVIAR a SIIGO (ver assertCanCreateDocuments en
          // SiigoSupportDocumentSendService).
          await this.planSubscriptionService.resolveAllowedQuantity({
            companyId: company.id,
            provider,
            documentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
            requestedQuantity: groups.length,
          });

          const supplierNamesByNit = await this.resolveSupplierNamesByNit(
            company.id,
            provider,
          );

          const documents = groups.map((group) => {
            const payload = mapGroupedSupportDocumentToPayload(group);
            const supplierNit = normalizeSupplierNit(
              payload.supplier.documentNumber,
            );
            const supplierName = resolveImportedSupplierName(
              supplierNit,
              group.supplierName,
              supplierNamesByNit,
            );
            const terceroKnown =
              provider === IntegrationProvider.JARVIS &&
              Boolean(supplierNamesByNit.get(supplierNit)?.trim());

            payload.supplier.name = supplierName;
            payload.supplier.commercialName = supplierName;

            return this.electronicDocumentsRepository.create({
              companyId: company.id,
              cufe: payload.invoice.cufe || null,
              documentNumberThird:
                this.normalizeDocument(payload.supplier.documentNumber) || null,
              documentTypeThird: payload.supplier.documentType,
              electronicDocumentType: ElectronicDocumentType.SUPPORT_DOCUMENT,
              status: terceroKnown
                ? ElectronicDocumentStatus.ACCOUNT_MAPPED
                : ElectronicDocumentStatus.PENDING,
              supplierExistsInSiigo: terceroKnown ? true : null,
              payload,
            });
          });

          const savedDocuments = await this.dataSource.transaction(
            async (manager) => manager.save(ElectronicDocument, documents),
          );

          return { savedDocuments, supplierNamesByNit };
        },
      );

    const itemsTotal = groups.reduce(
      (total, group) => total + group.rows.length,
      0,
    );

    this.logger.log(
      `[companyId=${company.id}] Documentos Soporte importados (${provider}): documents=${savedDocuments.length}, items=${itemsTotal}`,
    );

    return {
      documentsCreated: savedDocuments.length,
      itemsTotal,
      documentIds: savedDocuments.map((document) => document.id),
      provider,
      supplierNamesByNit,
    };
  }

  /**
   * A diferencia de assertCanCreateDocuments (todo-o-nada), acá un lote que
   * excede el cupo restante del plan NO se rechaza completo: se crean los
   * primeros `allowed` documentos (mismo orden en que llegaron) y se
   * reporta cuántos quedaron sin crear por límite de plan, en vez de perder
   * un import de 500 filas contra un plan de 100 documentos solo porque no
   * caben las 500 — el llamador (InvoicesService.runPurchaseInvoiceImport)
   * usa `documentsSkippedByPlanLimit` para marcar esas filas puntuales.
   */
  async createFromPurchaseInvoiceRows(
    rows: Array<{
      issuerNit: string;
      issuerName: string;
      payload: ElectronicDocumentPayload;
    }>,
    companyId: string,
  ): Promise<{
    documentsCreated: number;
    documentsReused: number;
    itemsTotal: number;
    documentsSkippedByPlanLimit: number;
    /** Un resultado por fila de entrada, en el mismo orden — evita cualquier
     * ambigüedad de matchear por posición/cantidad entre filas y ids. */
    rows: Array<{
      cufe: string | null;
      documentId: string | null;
      skippedByPlanLimit: boolean;
      /** true si el documento se creó directo en PURCHASE_CREATED porque ya
       * existía en SIIGO (matcheado por provider_invoice) — el llamador no
       * debe mandarlo al pipeline de clasificación/envío automático, ya
       * está hecho. */
      alreadyInSiigo: boolean;
    }>;
  }> {
    if (!rows.length) {
      throw new BadRequestException(
        'No se encontraron facturas electrónicas recibidas para importar. Solo se procesan filas con Tipo de documento "Factura electrónica" y Grupo "Recibido".',
      );
    }

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

    const provider = await this.resolveDocumentProvider(company.id);

    // IDEMPOTENCIA: si una fila ya tiene un ElectronicDocument creado para
    // su CUFE en esta empresa (ej. el worker creó el documento pero murió
    // antes de guardar ese id en la fila del job, y la fila se reprocesó),
    // se reusa el documento existente en vez de crear uno duplicado. CUFE
    // es único por factura DIAN, es el identificador natural para esto.
    const cufesInBatch = rows
      .map((row) => row.payload.invoice.cufe)
      .filter((cufe): cufe is string => Boolean(cufe));
    const existingDocumentIdByCufe =
      await this.electronicDocumentsRepository.findByCompanyAndCufes(
        company.id,
        cufesInBatch,
      );

    const reusedRows = rows.filter((row) =>
      existingDocumentIdByCufe.has(row.payload.invoice.cufe),
    );
    const newRows = rows.filter(
      (row) => !existingDocumentIdByCufe.has(row.payload.invoice.cufe),
    );

    // Factura de compra ya creada en SIIGO (ej. se cargó antes por otro
    // medio, o ya se envió y este Excel se está reimportando por error): se
    // detecta por provider_invoice (prefix+number de la factura del
    // TERCERO — la misma clave que se le manda a SIIGO al crearla, ver
    // parseProviderInvoiceNumber) contra lo que ya trajo el último sync de
    // historial de compras. Si matchea, el documento se crea directo en
    // PURCHASE_CREATED (con el siigoPurchaseId/consecutivo real) en vez de
    // PENDING/ACCOUNT_MAPPED — evita que el import intente crearla de
    // nuevo. Solo aplica a SIIGO: Jarvis no sincroniza este historial.
    const alreadyInSiigoByProviderInvoice =
      provider === IntegrationProvider.SIIGO
        ? await this.resolveAlreadyInSiigoByProviderInvoice(
            company.id,
            newRows,
          )
        : new Map<string, HistorialFacturaProviderInvoiceMatch>();

    const {
      savedDocuments,
      documentsSkippedByPlanLimit,
      skippedRows,
      cufesAlreadyInSiigo,
    } = await this.withDocumentQuotaLock(
        company.id,
        ElectronicDocumentType.PURCHASE_INVOICE,
        async () => {
          // Solo se valida elegibilidad (plan activo, suscripción no
          // suspendida, tipo de documento incluido) — el cupo NUMÉRICO del
          // plan ya no limita cuántos documentos locales se crean acá.
          // Importar el Excel nunca debe descontar nada del plan; eso solo
          // ocurre al ENVIAR a SIIGO (ver assertCanCreateDocuments en
          // SiigoPurchaseSendService), que es cuando SIIGO ya respondió bien.
          await this.planSubscriptionService.resolveAllowedQuantity({
            companyId: company.id,
            provider,
            documentType: ElectronicDocumentType.PURCHASE_INVOICE,
            requestedQuantity: newRows.length,
          });

          const rowsToCreate = newRows;
          const skipped: typeof newRows = [];

          if (rowsToCreate.length === 0) {
            return {
              savedDocuments: [] as ElectronicDocument[],
              documentsSkippedByPlanLimit: skipped.length,
              skippedRows: skipped,
              cufesAlreadyInSiigo: new Set<string>(),
            };
          }

          const supplierNamesByNit = await this.resolveSupplierNamesByNit(
            company.id,
            provider,
          );

          const cufesAlreadyInSiigo = new Set<string>();

          const documents = rowsToCreate.map((row) => {
            const payload = row.payload;
            const supplierNit = normalizeSupplierNit(row.issuerNit);
            const supplierName = resolveImportedSupplierName(
              supplierNit,
              row.issuerName,
              supplierNamesByNit,
            );
            const terceroKnown =
              provider === IntegrationProvider.JARVIS &&
              Boolean(supplierNamesByNit.get(supplierNit)?.trim());

            payload.supplier.name = supplierName;
            payload.supplier.commercialName = supplierName;

            const providerInvoiceMatch = alreadyInSiigoByProviderInvoice.get(
              this.buildProviderInvoiceKey(payload.invoice),
            );

            if (providerInvoiceMatch && payload.invoice.cufe) {
              cufesAlreadyInSiigo.add(payload.invoice.cufe);
            }

            const document = this.electronicDocumentsRepository.create({
              companyId: company.id,
              cufe: payload.invoice.cufe || null,
              documentNumberThird:
                this.normalizeDocument(payload.supplier.documentNumber) || null,
              documentTypeThird: payload.supplier.documentType,
              electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE,
              status: providerInvoiceMatch
                ? ElectronicDocumentStatus.PURCHASE_CREATED
                : terceroKnown
                  ? ElectronicDocumentStatus.ACCOUNT_MAPPED
                  : ElectronicDocumentStatus.PENDING,
              // providerInvoiceMatch: la factura ya existe en SIIGO, así que
              // el proveedor TAMBIÉN existe ahí (es imposible que SIIGO
              // tenga una compra sin tercero) — antes esto quedaba en null
              // (terceroKnown solo aplica a JARVIS), lo que hacía que
              // SiigoDocumentPreparationService.prepareSupplierAndAccounts
              // tratara el documento como "proveedor sin confirmar" si algo
              // lo volvía a preparar más adelante, y de ahí terminaba
              // pisando el status PURCHASE_CREATED con ACCOUNT_REQUIRED (bug
              // real reportado: factura ya en SIIGO con consecutivo, pero
              // mostrando "Pendiente" con "Enviar" habilitado — riesgo real
              // de duplicarla en SIIGO si se reenviaba).
              supplierExistsInSiigo: providerInvoiceMatch
                ? true
                : terceroKnown
                  ? true
                  : null,
              payload,
            });

            // create() restringe a propósito el resto de sus campos (no se
            // arman documentos con siigoPurchaseId a mano en ningún otro
            // flujo) — acá sí corresponde: son datos reales de una compra
            // que YA existe en SIIGO, tomados del match por provider_invoice.
            if (providerInvoiceMatch) {
              document.siigoPurchaseId = providerInvoiceMatch.facturaId;
              document.siigoDocumentNumber =
                providerInvoiceMatch.siigoNumero != null
                  ? String(providerInvoiceMatch.siigoNumero)
                  : null;
              // Marca que este PURCHASE_CREATED es porque la factura YA
              // existía en SIIGO (no porque Jarvis la envió) — el frontend
              // lo muestra como "Existente en SIIGO" en vez de "Lista" (ver
              // mapDocumentToImportRowStatus). El resto de la lógica de
              // negocio (no reenviar, cupo, poder eliminarla localmente)
              // sigue tratando este documento igual que cualquier otro
              // PURCHASE_CREATED a propósito.
              document.alreadyInSiigo = true;
            }

            return document;
          });

          const saved = await this.dataSource.transaction(async (manager) =>
            manager.save(ElectronicDocument, documents),
          );

          if (cufesAlreadyInSiigo.size > 0) {
            this.logger.log(
              `[companyId=${company.id}] ${cufesAlreadyInSiigo.size} factura(s) de compra ya existían en SIIGO (matcheadas por provider_invoice) — se crearon directo como LISTA, sin reenviar.`,
            );
          }

          return {
            savedDocuments: saved,
            documentsSkippedByPlanLimit: skipped.length,
            skippedRows: skipped,
            cufesAlreadyInSiigo,
          };
        },
      );

    if (documentsSkippedByPlanLimit > 0) {
      this.logger.warn(
        `[companyId=${company.id}] Facturas de compra: ${documentsSkippedByPlanLimit} fila(s) no se crearon por límite del plan (creadas=${savedDocuments.length}, reusadas=${reusedRows.length}).`,
      );
    }

    this.logger.log(
      `[companyId=${company.id}] Facturas de compra importadas (${provider}): creadas=${savedDocuments.length}, reusadas=${reusedRows.length}`,
    );

    // documentId por CUFE de las recién creadas, en el mismo orden en que
    // se armó `documents` arriba (rowsToCreate mantiene el orden de newRows
    // sin los saltadas por cupo).
    const createdDocumentIdByCufe = new Map(
      savedDocuments
        .filter((document) => Boolean(document.cufe))
        .map((document) => [document.cufe as string, document.id]),
    );
    const skippedCufes = new Set(
      skippedRows.map((row) => row.payload.invoice.cufe),
    );

    const resultRows = rows.map((row) => {
      const cufe = row.payload.invoice.cufe || null;

      if (cufe && existingDocumentIdByCufe.has(cufe)) {
        return {
          cufe,
          documentId: existingDocumentIdByCufe.get(cufe) as string,
          skippedByPlanLimit: false,
          alreadyInSiigo: false,
        };
      }

      if (cufe && createdDocumentIdByCufe.has(cufe)) {
        return {
          cufe,
          documentId: createdDocumentIdByCufe.get(cufe) as string,
          skippedByPlanLimit: false,
          alreadyInSiigo: cufesAlreadyInSiigo.has(cufe),
        };
      }

      return {
        cufe,
        documentId: null,
        skippedByPlanLimit: cufe ? skippedCufes.has(cufe) : false,
        alreadyInSiigo: false,
      };
    });

    return {
      documentsCreated: savedDocuments.length,
      documentsReused: reusedRows.length,
      itemsTotal: savedDocuments.length + reusedRows.length,
      documentsSkippedByPlanLimit,
      rows: resultRows,
    };
  }

  /** "PREFIX::number" (prefix en mayúsculas) — misma normalización que
   * HistorialFacturasRepository.findByProviderInvoices, para poder cruzar
   * su resultado acá. */
  private buildProviderInvoiceKey(invoice: {
    number: string;
    prefix?: string;
  }): string {
    const { prefix, number } = resolveProviderInvoiceParts(invoice);
    return `${prefix.toUpperCase()}::${number}`;
  }

  /** Para cada fila, resuelve si su provider_invoice (prefix+number de la
   * factura del tercero) ya está creada en SIIGO, según lo que trajo el
   * último sync de historial de compras — ver findByProviderInvoices. */
  private async resolveAlreadyInSiigoByProviderInvoice(
    companyId: string,
    rows: Array<{ payload: ElectronicDocumentPayload }>,
  ): Promise<Map<string, HistorialFacturaProviderInvoiceMatch>> {
    if (rows.length === 0) {
      return new Map();
    }

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const keys = rows.map((row) =>
      resolveProviderInvoiceParts(row.payload.invoice),
    );

    return this.historialFacturasRepository.findByProviderInvoices(
      companyId,
      integration.id,
      keys,
    );
  }

  /**
   * Variante de un solo documento de resolveAlreadyInSiigoByProviderInvoice
   * — usada por SiigoDocumentPreparationService.prepareSupplierAndAccounts
   * para volver a chequear, cada vez que se prepara un documento (no solo
   * al importar), si su provider_invoice ya apareció en SIIGO. El chequeo
   * de import (createFromPurchaseInvoiceRows) es solo una FOTO del momento
   * de importar — si el sync de historial de compras trae esa factura
   * DESPUÉS, sin este segundo chequeo el documento seguiría su camino
   * normal (validar proveedor, mapear cuenta, y eventualmente intentar
   * crearla en SIIGO) arriesgándose a duplicarla.
   */
  async resolveAlreadyInSiigoMatch(
    document: { companyId: string; payload: ElectronicDocumentPayload },
    companyId: string,
  ): Promise<HistorialFacturaProviderInvoiceMatch | null> {
    const provider = await this.resolveDocumentProvider(companyId);

    if (provider !== IntegrationProvider.SIIGO) {
      // El historial de compras solo se sincroniza para SIIGO — Jarvis no
      // tiene este concepto de "factura ya existente" que detectar.
      return null;
    }

    const matches = await this.resolveAlreadyInSiigoByProviderInvoice(
      companyId,
      [document],
    );

    return matches.get(this.buildProviderInvoiceKey(document.payload.invoice)) ?? null;
  }

  async resolveDocumentProvider(
    companyId: string,
  ): Promise<IntegrationProvider> {
    const jarvis = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.JARVIS,
    );

    if (jarvis?.active) {
      return IntegrationProvider.JARVIS;
    }

    return IntegrationProvider.SIIGO;
  }

  private async resolveSupplierNamesByNit(
    companyId: string,
    provider: IntegrationProvider,
  ): Promise<Map<string, string>> {
    if (provider === IntegrationProvider.JARVIS) {
      return this.buildJarvisSupplierNameLookup(companyId);
    }

    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const configurations =
      await this.supplierConfigurationsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      );

    return buildSupplierNameLookup(configurations);
  }

  private async buildJarvisSupplierNameLookup(
    companyId: string,
  ): Promise<Map<string, string>> {
    const terceros =
      await this.jarvisTercerosRepository.findByCompany(companyId);
    const lookup = new Map<string, string>();

    for (const tercero of terceros) {
      const name = tercero.name?.trim();
      if (!name) {
        continue;
      }

      const digitsOnly = normalizeSupplierNit(tercero.documentNumber);
      if (digitsOnly) {
        lookup.set(digitsOnly, name);
      }

      const alphanumeric = tercero.documentNumber
        .replace(/[^\dA-Za-z]/g, '')
        .trim()
        .toUpperCase();
      if (alphanumeric) {
        lookup.set(alphanumeric, name);
      }
    }

    return lookup;
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
    const issueDateFrom = query.issueDateFrom?.trim() || undefined;
    const issueDateTo = query.issueDateTo?.trim() || undefined;
    const siigoDocumentNumbers = query.siigoDocumentNumbers
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
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
      issueDateFrom,
      issueDateTo,
      siigoDocumentNumbers,
      importStatuses,
      page,
      limit,
    });

    const supplierPreferences =
      await this.buildSupplierPreferencesLookup(items);

    return {
      items: items.map((document) =>
        mapElectronicDocumentToListItem(
          document,
          supplierPreferences.accounts.get(document.id) ?? null,
          supplierPreferences.paymentMethods.get(document.id) ?? null,
          supplierPreferences.retentions.get(document.id) ?? [],
          supplierPreferences.costCenters.get(document.id) ?? null,
          supplierPreferences.itemTaxes.get(document.id) ?? [],
          supplierPreferences.itemConfigs.get(document.id) ?? null,
          supplierPreferences.itemAccounts.get(document.id) ?? [],
          supplierPreferences.products.get(document.id) ?? null,
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
    products: Map<string, SuggestedProduct | null>;
    paymentMethods: Map<string, SupplierPaymentMethodPreference | null>;
    retentions: Map<string, SupplierRetentionPreference[]>;
    costCenters: Map<string, SupplierCostCenterPreference | null>;
    itemTaxes: Map<string, Array<SuggestedItemTax | null>>;
    itemConfigs: Map<string, SuggestedPurchaseItemConfig | null>;
    itemAccounts: Map<string, Array<SuggestedItemAccount | null>>;
  }> {
    const accounts = new Map<string, SuggestedAccount | null>();
    const products = new Map<string, SuggestedProduct | null>();
    const paymentMethods = new Map<
      string,
      SupplierPaymentMethodPreference | null
    >();
    const retentions = new Map<string, SupplierRetentionPreference[]>();
    const costCenters = new Map<string, SupplierCostCenterPreference | null>();
    const itemTaxes = new Map<string, Array<SuggestedItemTax | null>>();
    const itemConfigs = new Map<string, SuggestedPurchaseItemConfig | null>();
    const itemAccounts = new Map<string, Array<SuggestedItemAccount | null>>();

    if (!documents.length) {
      return {
        accounts,
        products,
        paymentMethods,
        retentions,
        costCenters,
        itemTaxes,
        itemConfigs,
        itemAccounts,
      };
    }

    const configurationIndex = new Map<
      string,
      Awaited<
        ReturnType<
          SupplierConfigurationsRepository['findByCompanyAndIntegration']
        >
      >[number]
    >();
    const itemMappingIndex = new Map<string, SupplierItemAccountMapping>();
    const integrationIdByCompanyId = new Map<string, string>();
    const accountNameByCodeByCompanyId = new Map<string, Map<string, string>>();
    const productNameByCodeByCompanyId = new Map<string, Map<string, string>>();
    const taxesCatalogByCompanyId = new Map<
      string,
      Awaited<ReturnType<SiigoTaxesCatalogService['listTaxes']>>
    >();
    const paymentTypesCatalogByKey = new Map<
      string,
      SiigoPaymentTypeCatalogItemDto[]
    >();
    const companyIds = [
      ...new Set(documents.map((document) => document.companyId)),
    ];

    for (const companyId of companyIds) {
      try {
        const provider = await this.resolveDocumentProvider(companyId);

        if (provider !== IntegrationProvider.SIIGO) {
          continue;
        }

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

        const itemAccountMappings =
          await this.supplierItemAccountMappingsRepository.findByCompanyAndIntegration(
            companyId,
            integration.id,
          );

        for (const [key, mapping] of indexSupplierItemAccountMappings(
          itemAccountMappings,
        )) {
          itemMappingIndex.set(key, mapping);
        }

        // Fuente de verdad del NOMBRE de una cuenta — cualquier sugerencia
        // (historial de compras, regla item-level, preferencia guardada)
        // solo conoce el código; el nombre real se resuelve acá contra el
        // catálogo de SIIGO, nunca se asume ni se usa el código como
        // nombre (ver resolveAccountNameFromCatalog más abajo).
        const siigoAccounts =
          await this.siigoAccountsRepository.findByCompanyAndIntegration(
            companyId,
            integration.id,
          );
        accountNameByCodeByCompanyId.set(
          companyId,
          buildAccountNameByCode(siigoAccounts),
        );

        const productsCatalog = await this.siigoProductsCatalogService
          .listProducts(companyId)
          .catch((): SiigoProductCatalogItemDto[] => []);
        productNameByCodeByCompanyId.set(
          companyId,
          new Map(
            productsCatalog.map((product) => [product.code, product.name]),
          ),
        );

        taxesCatalogByCompanyId.set(
          companyId,
          await this.siigoTaxesCatalogService.listTaxes({}, companyId),
        );

        // Catálogo de medios de pago, precargado una sola vez por empresa +
        // tipo de documento presente en este lote (no por documento — eso
        // agregaba una consulta a SIIGO por cada documento sin preferencia
        // guardada, y esta función corre en cada carga/poll de la tabla).
        const documentTypesForCompany = new Set(
          documents
            .filter((document) => document.companyId === companyId)
            .map((document) =>
              resolveSiigoPaymentDocumentType(
                document.electronicDocumentType ?? undefined,
              ),
            ),
        );

        for (const documentType of documentTypesForCompany) {
          const paymentTypesCatalog = await this.siigoPaymentTypesCatalogService
            .listPaymentTypes({ documentType }, companyId)
            .catch(() => []);
          paymentTypesCatalogByKey.set(
            `${companyId}|${documentType}`,
            paymentTypesCatalog,
          );
        }
      } catch {
        // Empresas sin SIIGO (p.ej. Jarvis) no tienen preferencias de cuenta.
      }
    }

    // mapWithConcurrency (no for...of secuencial): cada documento puede
    // necesitar hasta 2 consultas a la BD (findLinesByFacturaId,
    // resolvePaymentMethodByAccount) que antes se esperaban una por una —
    // una página de 30 documentos disparaba hasta 60 round trips
    // SECUENCIALES a la BD en este mismo request, lo que explicaba que
    // aplicar un filtro se sintiera lento aunque cada consulta individual
    // fuera rápida (bug real reportado: "las consultas se demoran mucho, es
    // solo a la BD, no debería"). Cada documento escribe en su propia
    // entrada de cada Map (por document.id), así que procesarlos en
    // paralelo es seguro — no hay estado compartido entre documentos.
    await mapWithConcurrency(documents, 8, async (document) => {
      const integrationId = integrationIdByCompanyId.get(document.companyId);
      const taxesCatalog = taxesCatalogByCompanyId.get(document.companyId);

      itemTaxes.set(
        document.id,
        (document.payload?.items ?? []).map((item) =>
          taxesCatalog
            ? resolveSuggestedTaxForItem(item.ivaPercentage, taxesCatalog)
            : null,
        ),
      );

      if (!integrationId) {
        accounts.set(document.id, null);
        products.set(document.id, null);
        paymentMethods.set(document.id, null);
        retentions.set(document.id, []);
        costCenters.set(document.id, null);
        itemConfigs.set(document.id, null);
        itemAccounts.set(
          document.id,
          (document.payload?.items ?? []).map(() => null),
        );
        return;
      }

      const accountNameByCode = accountNameByCodeByCompanyId.get(
        document.companyId,
      );
      const productNameByCode = productNameByCodeByCompanyId.get(
        document.companyId,
      );

      // Factura de compra ya detectada como creada en SIIGO al importar el
      // Excel (match por provider_invoice, ver createFromPurchaseInvoiceRows)
      // — nunca se envió desde Jarvis, así que no tiene
      // `payload.siigoSendConfiguration` guardado y los resolvers de abajo
      // devolverían todo en blanco (ver resolveSuggestedAccountForDocument y
      // compañía: solo miran ese snapshot cuando el status es
      // PURCHASE_CREATED). Se arma un snapshot equivalente a partir de lo que
      // el sync de historial trajo REALMENTE de SIIGO para esa factura
      // puntual, en vez de dejar cuenta/medio de pago/IVA/Retefuente vacíos.
      let historialSnapshot: HistorialFacturaInvoiceSnapshot | null = null;

      if (
        document.status === ElectronicDocumentStatus.PURCHASE_CREATED &&
        document.siigoPurchaseId &&
        !resolveSendConfigurationFromPayload(document.payload)
      ) {
        const historialLines =
          await this.historialFacturasRepository.findLinesByFacturaId(
            document.companyId,
            integrationId,
            document.siigoPurchaseId,
          );

        if (historialLines.length > 0) {
          const documentType = resolveSiigoPaymentDocumentType(
            document.electronicDocumentType ?? undefined,
          );

          historialSnapshot = buildInvoiceSnapshotFromHistorialLines(
            historialLines,
            paymentTypesCatalogByKey.get(
              `${document.companyId}|${documentType}`,
            ) ?? [],
          );
        }
      }

      const suggestedProduct = resolveSuggestedProductForDocument(document);
      products.set(
        document.id,
        suggestedProduct
          ? {
              ...suggestedProduct,
              name:
                productNameByCode?.get(suggestedProduct.code) ??
                suggestedProduct.name,
            }
          : null,
      );

      const suggestedAccount =
        historialSnapshot?.account ??
        resolveSuggestedAccountForDocument(
          document,
          configurationIndex,
          itemMappingIndex,
          integrationId,
        );
      accounts.set(
        document.id,
        suggestedAccount && accountNameByCode
          ? {
              ...suggestedAccount,
              name: resolveAccountNameFromCatalog(
                suggestedAccount.code,
                suggestedAccount.name,
                accountNameByCode,
              )!,
            }
          : suggestedAccount,
      );

      const suggestedItemAccounts = resolveSuggestedAccountsForDocumentItems(
        document,
        configurationIndex,
        itemMappingIndex,
        integrationId,
      );
      itemAccounts.set(
        document.id,
        suggestedItemAccounts.map((itemAccount) =>
          itemAccount && accountNameByCode
            ? {
                ...itemAccount,
                name: resolveAccountNameFromCatalog(
                  itemAccount.code,
                  itemAccount.name,
                  accountNameByCode,
                )!,
              }
            : itemAccount,
        ),
      );
      const suggestedPaymentMethod =
        historialSnapshot?.paymentMethod ??
        resolveSuggestedPaymentMethodForDocument(
          document,
          configurationIndex,
          integrationId,
        );

      if (suggestedPaymentMethod) {
        paymentMethods.set(document.id, suggestedPaymentMethod);
      } else {
        const documentType = resolveSiigoPaymentDocumentType(
          document.electronicDocumentType ?? undefined,
        );
        const paymentTypesCatalog =
          paymentTypesCatalogByKey.get(
            `${document.companyId}|${documentType}`,
          ) ?? [];

        // Sin medio de pago por proveedor (nuevo o variable): antes de caer
        // al fallback genérico por contado/crédito, se prueba el medio de
        // pago dominante de la CUENTA a la que se sugirió este documento
        // (sea por IA o por historial) — caso real reportado: proveedor
        // nuevo (D1 SAS) sin historial propio, pero la cuenta "Elementos de
        // aseo y Cafetería" siempre se paga a crédito a proveedores en el
        // histórico de otros proveedores que también usan esa cuenta.
        const accountBasedPaymentMethod = suggestedAccount
          ? await this.resolvePaymentMethodByAccount(
              document.companyId,
              integrationId,
              suggestedAccount.code,
              paymentTypesCatalog,
            )
          : null;

        paymentMethods.set(
          document.id,
          accountBasedPaymentMethod ??
            resolveCreditFallbackPaymentMethod(
              document.payload?.invoice?.isCreditPayment,
              paymentTypesCatalog,
            ),
        );
      }
      // Retenciones que el vendedor ya certificó en la factura DIAN original
      // (NextPyme with_holding_tax_totals) — dato de ESTA factura puntual,
      // usado solo como ÚLTIMO recurso cuando ni el historial confirmado ni
      // una preferencia guardada resolvieron nada (nunca pisa una decisión
      // ya tomada). Ver resolveSuggestedRetentionsFromInvoice.
      const invoiceWithholdingMatches = taxesCatalog
        ? resolveSuggestedRetentionsFromInvoice(
            document.payload?.withholdings,
            taxesCatalog,
          )
        : [];
      const invoiceDocumentRetentions = invoiceWithholdingMatches.filter(
        (tax) => isDocumentLevelSupportDocumentRetentionType(tax.type),
      );
      const invoiceRetefuente =
        invoiceWithholdingMatches.find((tax) =>
          isItemLevelSupportDocumentRetentionType(tax.type),
        ) ?? null;

      const suggestedDocumentRetentions = resolveSuggestedRetentionsForDocument(
        document,
        configurationIndex,
        integrationId,
      );
      retentions.set(
        document.id,
        suggestedDocumentRetentions.length > 0
          ? suggestedDocumentRetentions
          : invoiceDocumentRetentions,
      );
      costCenters.set(
        document.id,
        resolveSuggestedCostCenterForDocument(
          document,
          configurationIndex,
          integrationId,
        ),
      );
      const suggestedItemConfig =
        historialSnapshot?.itemConfig ??
        resolveSuggestedItemConfigForDocument(
          document,
          configurationIndex,
          integrationId,
        ) ??
        (invoiceRetefuente
          ? {
              itemType: null,
              accountCode: null,
              accountName: null,
              productCode: null,
              productName: null,
              ivaTax: null,
              retefuenteTax: invoiceRetefuente,
              paymentMethod: null,
            }
          : null);
      const resolvedProductName =
        suggestedItemConfig?.productCode && productNameByCode
          ? (productNameByCode.get(suggestedItemConfig.productCode) ??
            suggestedItemConfig.productName)
          : suggestedItemConfig?.productName;

      itemConfigs.set(
        document.id,
        suggestedItemConfig
          ? {
              ...suggestedItemConfig,
              retefuenteTax: suggestedItemConfig.retefuenteTax ?? invoiceRetefuente,
              accountName:
                suggestedItemConfig.accountCode && accountNameByCode
                  ? resolveAccountNameFromCatalog(
                      suggestedItemConfig.accountCode,
                      suggestedItemConfig.accountName,
                      accountNameByCode,
                    )
                  : suggestedItemConfig.accountName,
              productName: resolvedProductName ?? null,
            }
          : suggestedItemConfig,
      );
    });

    return {
      accounts,
      products,
      paymentMethods,
      retentions,
      costCenters,
      itemTaxes,
      itemConfigs,
      itemAccounts,
    };
  }

  /**
   * Medio de pago dominante de una cuenta contable puntual (ver
   * findDominantPaymentMethodByCuenta), validado contra el catálogo REAL de
   * medios de pago de la empresa antes de confiarlo — el histórico solo
   * guarda id+nombre tal como estaban en el momento de esa factura vieja;
   * si ese medio de pago ya no existe en SIIGO (borrado o renombrado desde
   * entonces), se descarta en vez de mostrar un id que ya no es válido.
   */
  private async resolvePaymentMethodByAccount(
    companyId: string,
    integrationId: string,
    accountCode: string,
    paymentTypesCatalog: SiigoPaymentTypeCatalogItemDto[],
  ): Promise<SupplierPaymentMethodPreference | null> {
    const dominant =
      await this.historialFacturasRepository.findDominantPaymentMethodByCuenta(
        companyId,
        integrationId,
        accountCode,
      );

    if (!dominant) {
      return null;
    }

    const catalogMatch = paymentTypesCatalog.find(
      (paymentType) => paymentType.id === dominant.id,
    );

    if (!catalogMatch) {
      return null;
    }

    return {
      id: catalogMatch.id,
      name: catalogMatch.name,
      type: catalogMatch.type,
      dueDate: catalogMatch.dueDate,
    };
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
