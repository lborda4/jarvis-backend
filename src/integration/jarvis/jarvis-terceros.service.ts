import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeSupportDocumentType } from '../../invoices/helpers/support-document-type.helper';
import { mapWithConcurrency } from '../../common/helpers/concurrency.helper';
import { ElectronicDocumentsRepository } from '../../electronic-document/repositories/electronic-documents.repository';
import { normalizeJarvisDocumentNumber } from './helpers/jarvis-document-number.helper';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  CreateJarvisTercerosBulkResponseDto,
  CreateJarvisTerceroRequestDto,
  CreateJarvisTerceroResponseDto,
  JarvisCatalogListResponseDto,
  JarvisTerceroDto,
  JarvisTercerosListResponseDto,
  ListJarvisTypeLiabilitiesResponseDto,
  ListPendingJarvisSuppliersResponseDto,
  LookupJarvisTerceroNitResponseDto,
  UpdateJarvisTerceroRequestDto,
  UpdateJarvisTerceroResponseDto,
} from './dto/jarvis-tercero.dto';
import { JarvisTercero } from './entities/jarvis-tercero.entity';
import { JarvisClientType } from './enums/jarvis-client-type.enum';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';
import { JarvisEntityType } from './enums/jarvis-entity-type.enum';
import { JarvisFiscalRegime } from './enums/jarvis-fiscal-regime.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { JarvisVatRegime } from './enums/jarvis-vat-regime.enum';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';
import { JarvisDocumentPreparationService } from './jarvis-document-preparation.service';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';

const PENDING_SUPPLIERS_LOOKUP_CONCURRENCY = 5;

const VALID_DOCUMENT_TYPES = new Set<string>(Object.values(JarvisDocumentType));
const VALID_ENTITY_TYPES = new Set<string>(Object.values(JarvisEntityType));
const VALID_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));
const VALID_CLIENT_TYPES = new Set<string>(Object.values(JarvisClientType));
const VALID_FISCAL_REGIMES = new Set<string>(
  Object.values(JarvisFiscalRegime),
);
const VALID_VAT_REGIMES = new Set<string>(Object.values(JarvisVatRegime));

/** Valor por defecto de "Tipo de responsabilidad" — código de la tabla
 * maestra de NextPyme type_liabilities, id 117 (pedido explícito). */
const DEFAULT_TAX_RESPONSIBILITY = 'R-99-PN';

@Injectable()
export class JarvisTercerosService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly nextPymeRutService: NextPymeRutService,
    private readonly electronicDocumentsRepository: ElectronicDocumentsRepository,
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
    private readonly nextPymeMasterCatalogService: NextPymeMasterCatalogService,
  ) {}

  /** Catálogo real de NextPyme (tabla maestra type_liabilities) para el
   * desplegable "Tipo de responsabilidad" al crear un tercero. */
  async listTypeLiabilities(): Promise<ListJarvisTypeLiabilitiesResponseDto> {
    const rows = await this.nextPymeMasterCatalogService.getTypeLiabilities();

    return {
      items: rows
        .filter((row) => row.code)
        .map((row) => ({
          id: row.id,
          code: String(row.code),
          name: row.name,
        })),
    };
  }

  async list(
    companyId: string,
    search?: string,
  ): Promise<JarvisTercerosListResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

    const items = await this.jarvisTercerosRepository.findByCompany(
      trimmedCompanyId,
      search,
    );

    return {
      items: items.map((item) => this.toDto(item)),
      total: items.length,
    };
  }

  async create(
    request: CreateJarvisTerceroRequestDto,
    companyId: string,
  ): Promise<CreateJarvisTerceroResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const integration = await this.requireJarvisIntegration(trimmedCompanyId);

    const documentType = normalizeSupportDocumentType(request.document_type);
    if (!VALID_DOCUMENT_TYPES.has(documentType)) {
      throw new BadRequestException(
        'El tipo de documento debe ser NIT, CC, CE o PA.',
      );
    }

    const documentNumber = normalizeJarvisDocumentNumber(
      request.document_number,
    );
    if (!documentNumber) {
      throw new BadRequestException('El número de documento es obligatorio.');
    }

    const name = request.name?.trim();
    if (!name) {
      throw new BadRequestException('El nombre del tercero es obligatorio.');
    }

    const entityType = request.entity_type;
    if (entityType && !VALID_ENTITY_TYPES.has(entityType)) {
      throw new BadRequestException('El tipo de persona no es válido.');
    }

    const taxRegime = request.tax_regime;
    if (taxRegime && !VALID_TAX_REGIMES.has(taxRegime)) {
      throw new BadRequestException('El régimen tributario no es válido.');
    }

    const clientType = request.client_type;
    if (clientType && !VALID_CLIENT_TYPES.has(clientType)) {
      throw new BadRequestException(
        'El tipo de cliente debe ser "client" o "supplier".',
      );
    }

    const fiscalRegime = request.fiscal_regime;
    if (fiscalRegime && !VALID_FISCAL_REGIMES.has(fiscalRegime)) {
      throw new BadRequestException('El régimen fiscal no es válido.');
    }

    const vatRegime = request.vat_regime;
    if (vatRegime && !VALID_VAT_REGIMES.has(vatRegime)) {
      throw new BadRequestException('La responsabilidad de IVA no es válida.');
    }

    const existing =
      await this.jarvisTercerosRepository.findByCompanyAndDocument(
        trimmedCompanyId,
        documentType,
        documentNumber,
      );

    if (existing) {
      throw new ConflictException(
        'Ya existe un tercero con ese tipo y número de documento.',
      );
    }

    const tercero = await this.jarvisTercerosRepository.save(
      this.jarvisTercerosRepository.create({
        companyId: trimmedCompanyId,
        integrationId: integration.id,
        documentType,
        documentNumber,
        checkDigit: request.check_digit?.trim() || null,
        name,
        entityType: entityType ?? null,
        taxRegime: taxRegime ?? null,
        fiscalRegime: fiscalRegime ?? null,
        vatRegime: vatRegime ?? null,
        economicActivity: request.economic_activity?.trim() || null,
        clientType: clientType ?? null,
        email: request.email?.trim() || null,
        phone: request.phone?.trim() || null,
        address: request.address?.trim() || null,
        country: request.country?.trim() || null,
        city: request.city?.trim() || null,
        cityCode: request.city_code?.trim() || null,
      }),
    );

    // Este create() se usa tanto desde el botón "Crear tercero" de una fila
    // puntual (ahí el modal después llama a resumeElectronicDocument, que ya
    // propaga a los demás documentos del mismo proveedor) como desde
    // "Crear" en el listado de Terceros, SIN ningún documento disparador —
    // en ese segundo caso nada más se encargaba de avisarle a los documentos
    // ya importados de este proveedor que estaban esperando a que existiera
    // (bug real reportado: se crea el proveedor pero esos registros se
    // quedan en "Requiere proveedor"). Se resuelven acá siempre, de una vez
    // para todos — si el modal llama a resumeElectronicDocument después,
    // no encuentra nada pendiente y no hace nada de más.
    await this.jarvisDocumentPreparationService.resolveSiblingsForSupplier(
      trimmedCompanyId,
      documentNumber,
      name,
    );

    return {
      success: true,
      tercero: this.toDto(tercero),
    };
  }

  async update(
    id: string,
    request: UpdateJarvisTerceroRequestDto,
    companyId: string,
  ): Promise<UpdateJarvisTerceroResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

    const tercero = await this.jarvisTercerosRepository.findByIdAndCompany(
      id,
      trimmedCompanyId,
    );
    if (!tercero) {
      throw new NotFoundException('El tercero no existe.');
    }

    const name = request.name?.trim();
    if (!name) {
      throw new BadRequestException('El nombre del tercero es obligatorio.');
    }

    const entityType = request.entity_type;
    if (entityType && !VALID_ENTITY_TYPES.has(entityType)) {
      throw new BadRequestException('El tipo de persona no es válido.');
    }

    const taxRegime = request.tax_regime;
    if (taxRegime && !VALID_TAX_REGIMES.has(taxRegime)) {
      throw new BadRequestException('El régimen tributario no es válido.');
    }

    const clientType = request.client_type;
    if (clientType && !VALID_CLIENT_TYPES.has(clientType)) {
      throw new BadRequestException(
        'El tipo de cliente debe ser "client" o "supplier".',
      );
    }

    const fiscalRegime = request.fiscal_regime;
    if (fiscalRegime && !VALID_FISCAL_REGIMES.has(fiscalRegime)) {
      throw new BadRequestException('El régimen fiscal no es válido.');
    }

    const vatRegime = request.vat_regime;
    if (vatRegime && !VALID_VAT_REGIMES.has(vatRegime)) {
      throw new BadRequestException('La responsabilidad de IVA no es válida.');
    }

    // El tipo y número de documento no se editan aquí (son la identidad del
    // tercero y forman su índice único); solo los datos de contacto/perfil.
    tercero.name = name;
    tercero.checkDigit = request.check_digit?.trim() || null;
    tercero.entityType = entityType ?? null;
    tercero.taxRegime = taxRegime ?? null;
    tercero.fiscalRegime = fiscalRegime ?? null;
    tercero.vatRegime = vatRegime ?? null;
    tercero.economicActivity = request.economic_activity?.trim() || null;
    tercero.clientType = clientType ?? null;
    tercero.email = request.email?.trim() || null;
    tercero.phone = request.phone?.trim() || null;
    tercero.address = request.address?.trim() || null;
    tercero.country = request.country?.trim() || null;
    tercero.city = request.city?.trim() || null;
    tercero.cityCode = request.city_code?.trim() || null;

    const saved = await this.jarvisTercerosRepository.save(tercero);

    return {
      success: true,
      tercero: this.toDto(saved),
    };
  }

  async lookupNit(
    companyId: string,
    documentType?: JarvisDocumentType,
    identificationNumber?: string,
  ): Promise<LookupJarvisTerceroNitResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);

    const resolvedDocumentType = documentType ?? JarvisDocumentType.NIT;
    if (!VALID_DOCUMENT_TYPES.has(resolvedDocumentType)) {
      throw new BadRequestException(
        'El tipo de documento debe ser NIT, CC, CE o PA.',
      );
    }

    const documentNumber = (identificationNumber ?? '')
      .split('-')[0]
      .replace(/\D/g, '');
    if (documentNumber.length < 5 || documentNumber.length > 15) {
      throw new BadRequestException(
        'Ingresa un número de documento válido de entre 5 y 15 dígitos.',
      );
    }

    const companyToken = await this.resolveCompanyNextPymeToken(
      trimmedCompanyId,
    );

    return this.nextPymeRutService.lookupDocument(
      resolvedDocumentType,
      documentNumber,
      companyToken,
    );
  }

  /**
   * Prefer company Jarvis `token_nextpyme` when configured.
   * Otherwise NextPymeRutService falls back to NEXTPYME_API_TOKEN.
   */
  private async resolveCompanyNextPymeToken(
    companyId: string,
  ): Promise<string | undefined> {
    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        companyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration?.credentials) {
      return undefined;
    }

    const credentials = normalizeJarvisCredentials(integration.credentials);
    const token = credentials.token_nextpyme?.trim();
    return token || undefined;
  }

  private requireCompanyId(companyId: string): string {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    return trimmedCompanyId;
  }

  private async requireJarvisIntegration(companyId: string) {
    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        companyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      throw new NotFoundException(
        'La empresa activa no tiene integración Jarvis configurada.',
      );
    }

    return integration;
  }

  private toDto(tercero: JarvisTercero): JarvisTerceroDto {
    return {
      id: tercero.id,
      document_type: tercero.documentType,
      document_number: tercero.documentNumber,
      check_digit: tercero.checkDigit,
      name: tercero.name,
      entity_type: tercero.entityType,
      tax_regime: tercero.taxRegime,
      fiscal_regime: tercero.fiscalRegime,
      vat_regime: tercero.vatRegime,
      economic_activity: tercero.economicActivity,
      client_type: tercero.clientType,
      email: tercero.email,
      phone: tercero.phone,
      address: tercero.address,
      country: tercero.country,
      city: tercero.city,
      city_code: tercero.cityCode,
      created_at: tercero.createdAt.toISOString(),
      updated_at: tercero.updatedAt.toISOString(),
    };
  }
}
