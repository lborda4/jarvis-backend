import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeSupportDocumentType } from '../../invoices/helpers/support-document-type.helper';
import { normalizeJarvisDocumentNumber } from './helpers/jarvis-document-number.helper';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  CreateJarvisTerceroRequestDto,
  CreateJarvisTerceroResponseDto,
  JarvisCatalogListResponseDto,
  JarvisTerceroDto,
  JarvisTercerosListResponseDto,
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
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';

const VALID_DOCUMENT_TYPES = new Set<string>(Object.values(JarvisDocumentType));
const VALID_ENTITY_TYPES = new Set<string>(Object.values(JarvisEntityType));
const VALID_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));
const VALID_CLIENT_TYPES = new Set<string>(Object.values(JarvisClientType));
const VALID_FISCAL_REGIMES = new Set<string>(
  Object.values(JarvisFiscalRegime),
);
const VALID_VAT_REGIMES = new Set<string>(Object.values(JarvisVatRegime));

@Injectable()
export class JarvisTercerosService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly nextPymeRutService: NextPymeRutService,
    private readonly masterCatalogService: NextPymeMasterCatalogService,
  ) {}

  /** Municipios (tabla maestra de NextPyme) para el selector de ciudad. */
  async listMunicipalities(
    companyId: string,
  ): Promise<JarvisCatalogListResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const token = await this.resolveCompanyNextPymeToken(trimmedCompanyId);
    const rows = await this.masterCatalogService.getMunicipalities(token);
    const items = rows.map((row) => ({
      code: row.code ? String(row.code) : null,
      name: row.name,
    }));
    return { items, total: items.length };
  }

  /** Países (tabla maestra de NextPyme) para el selector de país. */
  async listCountries(
    companyId: string,
  ): Promise<JarvisCatalogListResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const token = await this.resolveCompanyNextPymeToken(trimmedCompanyId);
    const rows = await this.masterCatalogService.getCountries(token);
    const items = rows.map((row) => ({
      code: row.code ? String(row.code) : null,
      name: row.name,
    }));
    return { items, total: items.length };
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
