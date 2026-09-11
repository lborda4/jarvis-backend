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
  CreateJarvisTercerosBulkRequestDto,
  JarvisTerceroDto,
  JarvisTercerosListResponseDto,
  ListPendingJarvisSuppliersResponseDto,
  LookupJarvisTerceroNitResponseDto,
  PendingJarvisSupplierDto,
} from './dto/jarvis-tercero.dto';
import { JarvisTercero } from './entities/jarvis-tercero.entity';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';
import { JarvisEntityType } from './enums/jarvis-entity-type.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';
import { JarvisDocumentPreparationService } from './jarvis-document-preparation.service';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisTercerosRepository } from './repositories/jarvis-terceros.repository';

const PENDING_SUPPLIERS_LOOKUP_CONCURRENCY = 5;

const VALID_DOCUMENT_TYPES = new Set<string>(Object.values(JarvisDocumentType));
const VALID_ENTITY_TYPES = new Set<string>(Object.values(JarvisEntityType));
const VALID_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));

@Injectable()
export class JarvisTercerosService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly jarvisTercerosRepository: JarvisTercerosRepository,
    private readonly nextPymeRutService: NextPymeRutService,
    private readonly electronicDocumentsRepository: ElectronicDocumentsRepository,
    private readonly jarvisDocumentPreparationService: JarvisDocumentPreparationService,
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

  /**
   * Candidatos a crear para el modal de creación masiva: un proveedor
   * distinto por cada documento en "Requiere proveedor" (ver
   * findPendingSupplierCandidates), enriquecido con la consulta a NextPyme —
   * igual que el autocompletado del modal uno por uno (ver
   * CreateJarvisTerceroModal en el frontend), pero para todos los pendientes
   * de una vez. Si NextPyme falla para un proveedor puntual, ese proveedor
   * simplemente queda con el nombre que ya traía el documento importado y
   * sin correo — no tumba el listado completo.
   */
  async listPendingSuppliers(
    companyId: string,
  ): Promise<ListPendingJarvisSuppliersResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    await this.requireJarvisIntegration(trimmedCompanyId);

    const pendingRows =
      await this.electronicDocumentsRepository.findPendingSupplierCandidates(
        trimmedCompanyId,
      );
    const companyToken = await this.resolveCompanyNextPymeToken(
      trimmedCompanyId,
    );

    const items = await mapWithConcurrency<
      (typeof pendingRows)[number],
      PendingJarvisSupplierDto
    >(pendingRows, PENDING_SUPPLIERS_LOOKUP_CONCURRENCY, async (row) => {
      const documentType = normalizeSupportDocumentType(
        row.documentTypeThird ?? undefined,
      ) as JarvisDocumentType;
      const documentNumber = normalizeJarvisDocumentNumber(
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
   * Crea varios terceros de una sola vez desde el modal de creación masiva.
   * A diferencia de `create`, un proveedor que ya tiene tercero no rompe el
   * lote entero — se cuenta como "skipped" y se sigue con el resto. Por cada
   * proveedor creado, reanuda la preparación de UN documento pendiente suyo
   * (`document_id`, tomado del listado de GET terceros/pending); el resto de
   * documentos del mismo proveedor se resuelven solos vía
   * resolvePendingSiblings en JarvisDocumentPreparationService.
   */
  async createBulk(
    request: CreateJarvisTercerosBulkRequestDto,
    companyId: string,
  ): Promise<CreateJarvisTercerosBulkResponseDto> {
    const trimmedCompanyId = this.requireCompanyId(companyId);
    const integration = await this.requireJarvisIntegration(trimmedCompanyId);

    let created = 0;
    let skipped = 0;
    const documentIdsToResume: string[] = [];

    for (const supplier of request.suppliers ?? []) {
      const documentType = normalizeSupportDocumentType(
        supplier.document_type,
      );
      if (!VALID_DOCUMENT_TYPES.has(documentType)) {
        continue;
      }

      const documentNumber = normalizeJarvisDocumentNumber(
        supplier.document_number,
      );
      const name = supplier.name?.trim();
      if (!documentNumber || !name) {
        continue;
      }

      const existing =
        await this.jarvisTercerosRepository.findByCompanyAndDocument(
          trimmedCompanyId,
          documentType,
          documentNumber,
        );

      if (existing) {
        skipped += 1;
        if (supplier.document_id?.trim()) {
          documentIdsToResume.push(supplier.document_id.trim());
        }
        continue;
      }

      await this.jarvisTercerosRepository.save(
        this.jarvisTercerosRepository.create({
          companyId: trimmedCompanyId,
          integrationId: integration.id,
          documentType,
          documentNumber,
          checkDigit: null,
          name,
          entityType: null,
          taxRegime: null,
          email: supplier.email?.trim() || null,
          phone: null,
          address: null,
        }),
      );

      created += 1;
      if (supplier.document_id?.trim()) {
        documentIdsToResume.push(supplier.document_id.trim());
      }
    }

    if (documentIdsToResume.length > 0) {
      this.jarvisDocumentPreparationService.prepareDocumentsInBackground(
        documentIdsToResume,
        trimmedCompanyId,
      );
    }

    return { created, skipped };
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
      email: tercero.email,
      phone: tercero.phone,
      address: tercero.address,
      created_at: tercero.createdAt.toISOString(),
      updated_at: tercero.updatedAt.toISOString(),
    };
  }
}
