import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { ElectronicDocument } from '../../electronic-document/entities/electronic-document.entity';
import { resolveSupplierDocumentFromPayload } from '../../electronic-document/helpers/electronic-document-supplier.helper';
import { ElectronicDocumentService } from '../../electronic-document/electronic-document.service';
import { ElectronicDocumentsRepository } from '../../electronic-document/repositories/electronic-documents.repository';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { LookupJarvisTerceroNitResponseDto } from '../jarvis/dto/jarvis-tercero.dto';
import { JarvisDocumentType } from '../jarvis/enums/jarvis-document-type.enum';
import { NextPymeRutService } from '../jarvis/nextpyme-rut.service';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SupplierConfigurationsRepository } from '../repositories/supplier-configurations.repository';
import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SIIGO_DEFAULT_ITEM_TYPE } from './constants/supplier-configuration.constants';
import { CreateSiigoSupplierRequestDto } from './dto/create-siigo-supplier-request.dto';
import { CreateSiigoSupplierResponseDto } from './dto/create-siigo-supplier-response.dto';
import {
  CreateSiigoSuppliersBulkResponseDto,
  CreateSiigoSuppliersBulkResultItemDto,
  ListPendingSiigoSuppliersResponseDto,
  PendingSiigoSupplierDto,
} from './dto/create-siigo-suppliers-bulk.dto';
import { ListAutoCreatedSuppliersResponseDto } from './dto/list-auto-created-suppliers.dto';
import {
  getSiigoIntegration,
  normalizeSupplierDocument,
} from './helpers/siigo-context.helper';
import { executeSiigoRequestWithRetries } from './helpers/siigo-request-retry.helper';
import { getSiigoSupplierName } from './helpers/siigo-supplier.helper';
import { mapElectronicDocumentPayloadToSiigoSupplier } from './mappers/electronic-document-to-siigo-supplier.mapper';
import { mapSiigoCustomerToCreatedSupplierResponse } from './mappers/siigo-customer-to-supplier-response.mapper';
import { normalizeSiigoPersonType } from './helpers/siigo-supplier-identity.helper';
import { SiigoAuthService } from './siigo-auth.service';
import { SiigoSupplierService } from './siigo-supplier.service';
import { SiigoCustomer } from './interfaces/siigo-api.interface';
import { SiigoSupplierRequestDto } from './dto/siigo-supplier-request.dto';

/** Mapea el documentType (texto DIAN, ej. "NIT"/"CC"/"31"/"13") al enum que
 * pide la consulta RUT/RUES de NextPyme. NIT por defecto — la gran mayoría
 * de proveedores de factura de compra son personas jurídicas. */
function resolveJarvisDocumentType(
  documentType?: string | null,
): JarvisDocumentType {
  const normalized = documentType?.trim().toUpperCase() ?? '';

  if (
    normalized === 'CC' ||
    normalized === '13' ||
    normalized.includes('CIUDADANIA')
  ) {
    return JarvisDocumentType.CC;
  }

  if (
    normalized === 'CE' ||
    normalized === '22' ||
    normalized.includes('EXTRANJER')
  ) {
    return JarvisDocumentType.CE;
  }

  if (
    normalized === 'PA' ||
    normalized === '41' ||
    normalized.includes('PASAPORTE')
  ) {
    return JarvisDocumentType.PA;
  }

  return JarvisDocumentType.NIT;
}

const PENDING_SUPPLIERS_LOOKUP_CONCURRENCY = 5;
const SUPPLIERS_BULK_CREATE_CONCURRENCY = 5;

@Injectable()
export class SiigoSupplierCreationService {
  private readonly logger = new Logger(SiigoSupplierCreationService.name);

  constructor(
    private readonly siigoAuthService: SiigoAuthService,
    private readonly siigoSupplierService: SiigoSupplierService,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly supplierConfigurationsRepository: SupplierConfigurationsRepository,
    private readonly electronicDocumentService: ElectronicDocumentService,
    private readonly electronicDocumentsRepository: ElectronicDocumentsRepository,
    private readonly companiesRepository: CompaniesRepository,
    private readonly nextPymeRutService: NextPymeRutService,
  ) {}

  async createSupplier(
    request: CreateSiigoSupplierRequestDto,
    companyId: string,
    /** 'automatic' = disparado solo por SiigoDocumentPreparationService
     * (sin que el usuario clickeara nada) — marca
     * SupplierConfiguration.autoCreatedInSiigoAt para poder avisarle al
     * usuario después cuántos terceros se crearon solos. 'manual' (default)
     * = el botón "Crear tercero" del usuario, no se marca. */
    source: 'automatic' | 'manual' = 'manual',
  ): Promise<CreateSiigoSupplierResponseDto> {
    const documentId = request?.documentId?.trim();
    // Si no viene (creación automática), se deja en null: el mapper lo
    // infiere del documentType del proveedor (ver resolveSiigoSupplierIdentity).
    const personType = normalizeSiigoPersonType(request?.person_type);

    if (!documentId) {
      throw new BadRequestException('El campo documentId es obligatorio.');
    }

    const electronicDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    const profileName = request?.name?.trim();
    const profileDocumentNumber = request?.document_number?.trim();
    const profileDocumentType = request?.document_type?.trim();
    const profileCheckDigit = request?.check_digit?.trim();
    const profileEmail = request?.email?.trim();
    const profilePhone = request?.phone?.trim();
    const profileAddress = request?.address?.trim();

    if (
      profileName ||
      profileDocumentNumber ||
      profileDocumentType ||
      profileCheckDigit ||
      profileEmail ||
      profilePhone ||
      profileAddress
    ) {
      await this.electronicDocumentService.updatePayload(
        documentId,
        {
          ...electronicDocument.payload,
          supplier: {
            ...electronicDocument.payload.supplier,
            ...(profileName
              ? { name: profileName, commercialName: profileName }
              : {}),
            ...(profileDocumentNumber
              ? { documentNumber: profileDocumentNumber }
              : {}),
            ...(profileDocumentType
              ? { documentType: profileDocumentType }
              : {}),
            ...(profileCheckDigit ? { checkDigit: profileCheckDigit } : {}),
            ...(profileEmail ? { email: profileEmail } : {}),
            ...(profilePhone ? { phone: profilePhone } : {}),
            ...(profileAddress ? { address: profileAddress } : {}),
          },
        },
        companyId,
      );
    }

    const refreshedDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );
    const supplier = resolveSupplierDocumentFromPayload(
      refreshedDocument.payload,
    );

    if (!supplier.normalizedDocumentNumber) {
      throw new BadRequestException(
        'El documento electrónico no contiene un número de proveedor válido en el payload.',
      );
    }

    this.logger.log(
      `[documentId=${documentId}] Creación de tercero en SIIGO desde payload persistido`,
    );

    const company = await this.companiesRepository.findById(companyId);

    // El tercero se crea con lo que traiga RUT/RUES (dato oficial), no con
    // lo que venga del Excel de la DIAN — el Excel solo queda como
    // respaldo si la consulta falla o no encuentra nada.
    const rutRues = await this.lookupSupplierFromRutRues(
      supplier.normalizedDocumentNumber,
      refreshedDocument.payload.supplier.documentType,
      company?.nextPymeToken?.trim() || undefined,
    );
    const supplierPayload = rutRues
      ? {
          ...refreshedDocument.payload,
          supplier: {
            ...refreshedDocument.payload.supplier,
            ...(rutRues.name
              ? { name: rutRues.name, commercialName: rutRues.name }
              : {}),
            ...(rutRues.check_digit ? { checkDigit: rutRues.check_digit } : {}),
            ...(rutRues.address ? { address: rutRues.address } : {}),
            ...(rutRues.email ? { email: rutRues.email } : {}),
            ...(rutRues.phone ? { phone: rutRues.phone } : {}),
            ...(rutRues.cityCode ? { cityCode: rutRues.cityCode } : {}),
            ...(rutRues.stateCode ? { stateCode: rutRues.stateCode } : {}),
          },
        }
      : refreshedDocument.payload;

    const siigoPayload = mapElectronicDocumentPayloadToSiigoSupplier(
      supplierPayload,
      personType,
      { cityCode: company?.cityCode ?? null },
    );

    this.logger.log(
      `[documentId=${documentId}] Creando tercero en SIIGO (identification=${siigoPayload.identification}, idType=${siigoPayload.id_type}, personType=${siigoPayload.person_type})`,
    );

    try {
      const branchOffice = 0;
      const existingSupplier = await this.findSupplierInSiigoWithRetries(
        supplier.normalizedDocumentNumber,
        branchOffice,
        companyId,
      );
      const siigoSupplier =
        existingSupplier ??
        (await this.createSupplierInSiigoWithRetries(siigoPayload, companyId));

      if (existingSupplier) {
        this.logger.log(
          `[documentId=${documentId}] Tercero ya existe en SIIGO (nit=${supplier.normalizedDocumentNumber}); se reutiliza sin crear duplicado`,
        );
      } else {
        this.logger.log(
          `[documentId=${documentId}] Tercero creado en SIIGO (siigoCustomerId=${siigoSupplier.id})`,
        );
      }

      return this.completeSupplierCreation(
        documentId,
        companyId,
        refreshedDocument,
        supplier.normalizedDocumentNumber,
        siigoSupplier,
        !existingSupplier,
        source,
      );
    } catch (error) {
      this.logger.error(
        `[documentId=${documentId}] Error al crear tercero en SIIGO`,
        error instanceof Error ? error.stack : String(error),
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error
          ? error.message
          : 'Error inesperado al crear tercero en SIIGO',
      );
    }
  }

  /**
   * Candidatos a crear para el modal de creación masiva de terceros SIIGO:
   * un proveedor distinto por cada documento en "Requiere proveedor" (ver
   * findPendingSupplierCandidates), enriquecido con RUT/RUES de NextPyme —
   * mismo dato que createSupplier consulta de todas formas al crear, solo
   * que acá se hace por adelantado para poder mostrarlo en el modal antes de
   * confirmar el lote. Un fallo puntual de NextPyme no tumba el listado
   * completo — ese proveedor queda con el nombre del documento importado.
   */
  async listPendingSuppliers(
    companyId: string,
  ): Promise<ListPendingSiigoSuppliersResponseDto> {
    await getSiigoIntegration(this.integrationsRepository, companyId);

    const pendingRows =
      await this.electronicDocumentsRepository.findPendingSupplierCandidates(
        companyId,
      );
    const company = await this.companiesRepository.findById(companyId);
    const companyToken = company?.nextPymeToken?.trim() || undefined;

    const items = await mapWithConcurrency<
      (typeof pendingRows)[number],
      PendingSiigoSupplierDto
    >(pendingRows, PENDING_SUPPLIERS_LOOKUP_CONCURRENCY, async (row) => {
      const documentType = resolveJarvisDocumentType(row.documentTypeThird);
      const documentNumber = normalizeSupplierDocument(
        row.documentNumberThird,
      );

      let name = row.supplierName?.trim() || null;
      let email: string | null = null;

      if (documentNumber.length >= 5) {
        try {
          const lookup = await this.nextPymeRutService.lookupDocument(
            documentType,
            documentNumber,
            companyToken,
          );

          if (lookup.found) {
            name = lookup.name?.trim() || name;
            email = lookup.email?.trim() || null;
          }
        } catch {
          // Ver comentario del método: un fallo puntual no bloquea el resto.
        }
      }

      return {
        document_id: row.documentId,
        document_type: documentType,
        document_number: documentNumber,
        name,
        email,
      };
    });

    return { items };
  }

  /**
   * Crea varios terceros en SIIGO a la vez (modal de creación masiva) en vez
   * de uno por uno — cada createSupplier ya resuelve todo desde el payload
   * del documento (RUT/RUES, tipo de persona, reutiliza si ya existe en
   * SIIGO, propaga a los documentos hermanos del mismo NIT), así que acá
   * solo hace falta dispararlos en paralelo con un límite de concurrencia
   * (no todos de una, para no saturar la API de SIIGO) y que el fallo de
   * uno no tumbe el resto del lote.
   */
  async createSuppliersBulk(
    documentIds: string[],
    companyId: string,
  ): Promise<CreateSiigoSuppliersBulkResponseDto> {
    const uniqueIds = Array.from(
      new Set((documentIds ?? []).map((id) => id?.trim()).filter(Boolean)),
    );

    const results = await mapWithConcurrency<
      string,
      CreateSiigoSuppliersBulkResultItemDto
    >(uniqueIds, SUPPLIERS_BULK_CREATE_CONCURRENCY, async (documentId) => {
      try {
        await this.createSupplier({ documentId }, companyId, 'manual');
        return { documentId, success: true, errorMessage: null };
      } catch (error) {
        this.logger.error(
          `[documentId=${documentId}] Error al crear tercero en SIIGO (lote)`,
          error instanceof Error ? error.stack : String(error),
        );

        return {
          documentId,
          success: false,
          errorMessage:
            error instanceof Error
              ? error.message
              : 'Error inesperado al crear tercero en SIIGO',
        };
      }
    });

    const created = results.filter((result) => result.success).length;

    return {
      created,
      failed: results.length - created,
      results,
    };
  }

  /**
   * Consulta RUT/RUES en NextPyme por NIT, con el token propio de la
   * empresa (companies.next_pyme_token) si lo tiene configurado, si no cae
   * al token global. Devuelve null (no lanza) si falla o no encuentra
   * nada — el llamador cae al dato del Excel importado en ese caso, en vez
   * de bloquear la creación del tercero.
   */
  private async lookupSupplierFromRutRues(
    documentNumber: string,
    documentType: string | undefined,
    companyToken: string | undefined,
  ): Promise<LookupJarvisTerceroNitResponseDto | null> {
    try {
      const result = await this.nextPymeRutService.lookupDocument(
        resolveJarvisDocumentType(documentType),
        documentNumber,
        companyToken,
      );

      return result.found ? result : null;
    } catch (error) {
      this.logger.warn(
        `No se pudo consultar RUT/RUES para NIT=${documentNumber}; se usa la información del Excel importado: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return null;
    }
  }

  private async completeSupplierCreation(
    documentId: string,
    companyId: string,
    electronicDocument: ElectronicDocument,
    normalizedDocumentNumber: string,
    siigoSupplier: SiigoCustomer,
    createdNow: boolean,
    source: 'automatic' | 'manual',
  ): Promise<CreateSiigoSupplierResponseDto> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );
    const supplierName =
      getSiigoSupplierName(siigoSupplier) ||
      electronicDocument.payload.supplier.name ||
      `Proveedor ${normalizedDocumentNumber}`;

    await this.createSupplierConfiguration(
      electronicDocument.companyId,
      integration.id,
      normalizedDocumentNumber,
      supplierName,
      electronicDocument.payload.supplier.documentType || 'NIT',
      createdNow && source === 'automatic',
    );

    // Nunca pisar un documento que YA quedó PURCHASE_CREATED (enviado de
    // verdad, o ya existía en SIIGO al importar) — sea cual sea el status
    // que traía cuando arrancó esta llamada, se revisa el ACTUAL antes de
    // escribir. Bug real reportado: una factura ya creada en SIIGO (con
    // consecutivo real) terminaba mostrando "Pendiente" con "Enviar"
    // habilitado — riesgo de duplicarla en SIIGO si se reenviaba.
    const currentDocument = await this.electronicDocumentService.requireById(
      documentId,
      companyId,
    );

    if (currentDocument.status !== ElectronicDocumentStatus.PURCHASE_CREATED) {
      await this.electronicDocumentService.updateStatus(
        documentId,
        ElectronicDocumentStatus.ACCOUNT_REQUIRED,
        companyId,
      );
    }
    await this.electronicDocumentService.updateSupplierExistsInSiigo(
      documentId,
      true,
      companyId,
    );

    await this.resolvePendingSiblings(
      documentId,
      companyId,
      normalizedDocumentNumber,
      supplierName,
    );

    return {
      success: true,
      created: createdNow,
      supplier: mapSiigoCustomerToCreatedSupplierResponse(
        siigoSupplier,
        electronicDocument.payload,
      ),
    };
  }

  /**
   * Otros documentos ya importados del mismo proveedor (mismo NIT) que
   * quedaron en SUPPLIER_NOT_FOUND no se enteran solos de que el tercero ya
   * se creó en SIIGO — se actualizan aquí también, en vez de quedar en
   * "Requiere proveedor" hasta que alguien reintente uno por uno.
   */
  private async resolvePendingSiblings(
    resolvedDocumentId: string,
    companyId: string,
    normalizedDocumentNumber: string,
    supplierName: string,
  ): Promise<void> {
    const siblings =
      await this.electronicDocumentService.findSupplierNotFoundSiblings(
        companyId,
        normalizedDocumentNumber,
        resolvedDocumentId,
      );

    await Promise.all(
      siblings.map(async (sibling) => {
        try {
          await this.electronicDocumentService.updatePayloadAndStatus(
            sibling.id,
            {
              ...sibling.payload,
              supplier: {
                ...sibling.payload.supplier,
                name: supplierName,
                commercialName: supplierName,
              },
            },
            ElectronicDocumentStatus.ACCOUNT_REQUIRED,
            companyId,
          );
          await this.electronicDocumentService.updateSupplierExistsInSiigo(
            sibling.id,
            true,
            companyId,
          );
        } catch (error) {
          this.logger.error(
            `[documentId=${sibling.id}] Error al propagar tercero SIIGO resuelto`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }),
    );
  }

  private async findSupplierInSiigoWithRetries(
    supplierDocument: string,
    branchOffice: number,
    companyId: string,
  ): Promise<SiigoCustomer | null> {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'consultar tercero',
      (accessToken, partnerId) =>
        this.siigoSupplierService.findSupplierByNit(
          accessToken,
          supplierDocument,
          branchOffice,
          partnerId,
        ),
    );
  }

  private async createSupplierInSiigoWithRetries(
    payload: SiigoSupplierRequestDto,
    companyId: string,
  ): Promise<SiigoCustomer> {
    return executeSiigoRequestWithRetries(
      this.siigoAuthService,
      companyId,
      this.logger,
      'crear tercero',
      (accessToken, partnerId) =>
        this.siigoSupplierService.createSupplier(
          accessToken,
          payload,
          partnerId,
        ),
    );
  }

  private async createSupplierConfiguration(
    companyId: string,
    integrationId: string,
    supplierDocument: string,
    supplierName: string,
    supplierDocumentType: string,
    markAutoCreatedInSiigo: boolean,
  ): Promise<SupplierConfiguration> {
    const existing =
      await this.supplierConfigurationsRepository.findByCompanyIntegrationAndNormalizedSupplierDocument(
        companyId,
        integrationId,
        supplierDocument,
      );

    if (existing) {
      existing.supplierName = supplierName;
      existing.supplierDocument = normalizeSupplierDocument(supplierDocument);
      existing.supplierDocumentType = supplierDocumentType;
      if (markAutoCreatedInSiigo) {
        existing.autoCreatedInSiigoAt = new Date();
      }
      return this.supplierConfigurationsRepository.save(existing);
    }

    const configuration = this.supplierConfigurationsRepository.create({
      companyId,
      integrationId,
      supplierDocument: normalizeSupplierDocument(supplierDocument),
      supplierDocumentType,
      supplierName,
      itemType: SIIGO_DEFAULT_ITEM_TYPE,
    });

    if (markAutoCreatedInSiigo) {
      configuration.autoCreatedInSiigoAt = new Date();
    }

    return this.supplierConfigurationsRepository.save(configuration);
  }

  /** Terceros creados AUTOMÁTICAMENTE en SIIGO (sin que el usuario
   * clickeara "Crear tercero") desde `since` — el frontend lo consulta
   * justo después de un import para avisarle al usuario cuántos y cuáles
   * terceros se crearon solos, ver tryAutoCreateSupplier en
   * SiigoDocumentPreparationService. */
  async listAutoCreatedSuppliersSince(
    companyId: string,
    since: Date,
  ): Promise<ListAutoCreatedSuppliersResponseDto> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const configurations =
      await this.supplierConfigurationsRepository.findAutoCreatedSince(
        companyId,
        integration.id,
        since,
      );

    return {
      suppliers: configurations.map((configuration) => ({
        supplierDocument: configuration.supplierDocument,
        supplierName: configuration.supplierName || configuration.supplierDocument,
        createdAt: (
          configuration.autoCreatedInSiigoAt as Date
        ).toISOString(),
      })),
    };
  }
}
