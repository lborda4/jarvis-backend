import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeSupportDocumentType } from '../../invoices/helpers/support-document-type.helper';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  CreateJarvisTerceroRequestDto,
  CreateJarvisTerceroResponseDto,
  JarvisTerceroDto,
  JarvisTercerosListResponseDto,
  LookupJarvisTerceroNitResponseDto,
} from './dto/jarvis-tercero.dto';
import { JarvisTercero } from './entities/jarvis-tercero.entity';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';
import { JarvisEntityType } from './enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';

const VALID_DOCUMENT_TYPES = new Set<string>(Object.values(JarvisDocumentType));
const VALID_ENTITY_TYPES = new Set<string>(Object.values(JarvisEntityType));
const VALID_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));

@Injectable()
export class JarvisTercerosService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly nextPymeRutService: NextPymeRutService,
  ) {}

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

    const documentNumber = this.normalizeDocumentNumber(
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
        email: request.email?.trim() || null,
        phone: request.phone?.trim() || null,
        address: request.address?.trim() || null,
      }),
    );

    return {
      success: true,
      tercero: this.toDto(tercero),
    };
  }

  async lookupNit(
    companyId: string,
    documentType?: JarvisDocumentType,
    identificationNumber?: string,
  ): Promise<LookupJarvisTerceroNitResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

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

    return this.nextPymeRutService.lookupDocument(
      resolvedDocumentType,
      documentNumber,
    );
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

  private normalizeDocumentNumber(value?: string): string {
    return (value ?? '')
      .replace(/[^\dA-Za-z]/g, '')
      .trim()
      .toUpperCase();
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
      email: tercero.email,
      phone: tercero.phone,
      address: tercero.address,
      created_at: tercero.createdAt.toISOString(),
      updated_at: tercero.updatedAt.toISOString(),
    };
  }
}
