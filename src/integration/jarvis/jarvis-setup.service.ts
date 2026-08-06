import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import {
  JarvisCredentials,
  JarvisDianResolution,
} from '../interfaces/integration-credentials.interface';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { JarvisTaxRegime } from './enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from './enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from './enums/jarvis-vat-regime.enum';
import { JarvisCredentialsStatusResponseDto } from './dto/jarvis-credentials-status.dto';
import {
  SaveJarvisResolutionRequestDto,
  SaveJarvisResolutionResponseDto,
} from './dto/jarvis-resolution.dto';
import {
  SaveJarvisCredentialsRequestDto,
  SaveJarvisCredentialsResponseDto,
} from './dto/save-jarvis-credentials.dto';
import {
  areJarvisCredentialsConfigured,
  getJarvisResolutionNextConsecutive,
  isJarvisResolutionConfigured,
  normalizeJarvisCredentials,
} from './helpers/jarvis-credentials.helper';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import {
  NextPymeApiClient,
  NextPymeResolution,
} from './nextpyme/nextpyme-api.client';

const VALID_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));
const VALID_VAT_REGIMES = new Set<string>(Object.values(JarvisVatRegime));
const VALID_TAX_RESPONSIBILITIES = new Set<string>(
  Object.values(JarvisTaxResponsibility),
);
const VALID_RESOLUTION_KINDS = new Set<string>(
  Object.values(JarvisResolutionKind),
);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class JarvisSetupService {
  private readonly logger = new Logger(JarvisSetupService.name);

  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly planSubscriptionService: PlanSubscriptionService,
    private readonly nextPymeApiClient: NextPymeApiClient,
    private readonly nextPymeMasterCatalogService: NextPymeMasterCatalogService,
  ) {}

  async saveCredentials(
    request: SaveJarvisCredentialsRequestDto,
    companyId: string,
  ): Promise<SaveJarvisCredentialsResponseDto> {
    const trimmedCompanyId = companyId?.trim();
    const business_name = request.business_name?.trim();
    const trade_name = request.trade_name?.trim() || undefined;
    const economic_activity = request.economic_activity?.trim();
    const tax_regime = request.tax_regime;
    const vat_regime = request.vat_regime;
    const tax_responsibility = request.tax_responsibility;
    const country = request.country?.trim();
    const department = request.department?.trim();
    const municipality = request.municipality?.trim();
    const city = request.city?.trim();
    const email = request.email?.trim();
    const address = request.address?.trim();
    const phone = request.phone?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    if (!business_name) {
      throw new BadRequestException('La razón social es obligatoria.');
    }

    if (!tax_regime || !VALID_TAX_REGIMES.has(tax_regime)) {
      throw new BadRequestException(
        'Debe seleccionar un tipo de régimen válido.',
      );
    }

    if (!vat_regime || !VALID_VAT_REGIMES.has(vat_regime)) {
      throw new BadRequestException(
        'Debe seleccionar un régimen de IVA válido.',
      );
    }

    if (
      !tax_responsibility ||
      !VALID_TAX_RESPONSIBILITIES.has(tax_responsibility)
    ) {
      throw new BadRequestException(
        'Debe seleccionar una responsabilidad tributaria válida.',
      );
    }

    if (!economic_activity) {
      throw new BadRequestException('La actividad económica es obligatoria.');
    }

    if (!country) {
      throw new BadRequestException('El país es obligatorio.');
    }

    if (!department) {
      throw new BadRequestException('El departamento es obligatorio.');
    }

    if (!municipality) {
      throw new BadRequestException('El municipio es obligatorio.');
    }

    if (!city) {
      throw new BadRequestException('La ciudad es obligatoria.');
    }

    if (!email) {
      throw new BadRequestException('El correo es obligatorio.');
    }

    if (!address) {
      throw new BadRequestException('La dirección es obligatoria.');
    }

    if (!phone) {
      throw new BadRequestException('El teléfono es obligatorio.');
    }

    const configured_at = new Date().toISOString();
    const existing = await this.integrationsRepository.findByCompanyAndProvider(
      trimmedCompanyId,
      IntegrationProvider.JARVIS,
    );
    const existingCredentials = existing
      ? normalizeJarvisCredentials(existing.credentials)
      : undefined;

    const credentials: JarvisCredentials = {
      ...existingCredentials,
      business_name,
      trade_name,
      economic_activity,
      tax_regime,
      vat_regime,
      tax_responsibility,
      country,
      department,
      municipality,
      city,
      email,
      address,
      phone,
      configured_at,
      resolutions: existingCredentials?.resolutions,
    };

    let integration = existing;

    if (!integration) {
      integration = await this.integrationsRepository.save(
        this.integrationsRepository.create({
          companyId: trimmedCompanyId,
          provider: IntegrationProvider.JARVIS,
          credentials,
          active: true,
        }),
      );
    } else {
      integration.credentials = credentials;
      integration = await this.integrationsRepository.save(integration);
    }

    return {
      success: true,
      business_name,
      configured_at,
    };
  }

  async saveResolution(
    request: SaveJarvisResolutionRequestDto,
    companyId: string,
  ): Promise<SaveJarvisResolutionResponseDto> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    if (!VALID_RESOLUTION_KINDS.has(request.kind)) {
      throw new BadRequestException('Tipo de resolución no válido.');
    }

    const prefix = request.prefix?.trim().toUpperCase();
    const documentTypeLabel = request.documentTypeLabel?.trim();
    const resolutionNumber = request.formNumber?.trim();
    const technicalKey = request.technicalKey?.trim();
    const dateFrom = request.dateFrom?.trim();
    const dateTo = request.dateTo?.trim();
    const resolutionDate =
      request.authorizedAt?.trim() || dateFrom || undefined;
    const fromNumber = Number(request.fromNumber);
    const toNumber = Number(request.toNumber);

    if (!prefix) {
      throw new BadRequestException('El prefijo es obligatorio.');
    }

    if (!documentTypeLabel) {
      throw new BadRequestException(
        'El tipo de documento de la resolución es obligatorio.',
      );
    }

    if (!resolutionNumber) {
      throw new BadRequestException(
        'El número de resolución DIAN es obligatorio.',
      );
    }

    if (!technicalKey) {
      throw new BadRequestException('La clave técnica es obligatoria.');
    }

    if (!dateFrom || !DATE_PATTERN.test(dateFrom)) {
      throw new BadRequestException(
        'La fecha Desde de vigencia es inválida (use AAAA-MM-DD).',
      );
    }

    if (!dateTo || !DATE_PATTERN.test(dateTo)) {
      throw new BadRequestException(
        'La fecha Hasta de vigencia es inválida (use AAAA-MM-DD).',
      );
    }

    if (dateTo < dateFrom) {
      throw new BadRequestException(
        'La vigencia es inválida: Hasta es menor que Desde.',
      );
    }

    if (!resolutionDate || !DATE_PATTERN.test(resolutionDate)) {
      throw new BadRequestException(
        'La fecha de resolución es inválida (use AAAA-MM-DD).',
      );
    }

    if (!Number.isFinite(fromNumber) || fromNumber < 1) {
      throw new BadRequestException('El número Desde es inválido.');
    }

    if (!Number.isFinite(toNumber) || toNumber < fromNumber) {
      throw new BadRequestException('El número Hasta es inválido.');
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        trimmedCompanyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      throw new BadRequestException(
        'Complete primero la configuración inicial de la empresa.',
      );
    }

    const existing = normalizeJarvisCredentials(integration.credentials);

    if (!areJarvisCredentialsConfigured(existing)) {
      throw new BadRequestException(
        'Complete primero la configuración inicial de la empresa.',
      );
    }

    const typeDocumentId =
      request.kind === JarvisResolutionKind.SUPPORT_DOCUMENT
        ? this.nextPymeMasterCatalogService.getSupportDocumentTypeId()
        : this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId();

    await this.nextPymeApiClient.putConfigResolution({
      type_document_id: typeDocumentId,
      prefix,
      resolution: resolutionNumber,
      resolution_date: resolutionDate,
      technical_key: technicalKey,
      from: fromNumber,
      to: toNumber,
      generated_to_date: 0,
      date_from: dateFrom,
      date_to: dateTo,
    });

    this.nextPymeMasterCatalogService.invalidateResolutionsCache();

    // Persistimos en integrations.credentials todo lo necesario para emitir
    // (número de resolución DIAN, clave técnica, vigencia, rango y consecutivo).
    const localResolution: JarvisDianResolution = {
      kind: request.kind,
      formNumber: resolutionNumber,
      nit: request.nit?.trim() || null,
      checkDigit: request.checkDigit?.trim() || null,
      businessName: request.businessName?.trim() || null,
      documentTypeLabel,
      modalityCode: request.modalityCode?.trim() || null,
      prefix,
      fromNumber,
      toNumber,
      nextConsecutive: fromNumber,
      requestType: request.requestType?.trim() || null,
      year: request.year?.trim() || resolutionDate.slice(0, 4),
      authorizedAt: resolutionDate,
      technicalKey,
      dateFrom,
      dateTo,
      configuredAt: new Date().toISOString(),
    };

    const credentials: JarvisCredentials = {
      ...existing,
      resolutions: {
        ...existing.resolutions,
        ...(request.kind === JarvisResolutionKind.SUPPORT_DOCUMENT
          ? { support_document: localResolution }
          : { electronic_invoice: localResolution }),
      },
    };

    integration.credentials = credentials;
    await this.integrationsRepository.save(integration);

    return {
      success: true,
      resolution: localResolution,
    };
  }

  /**
   * Reserva el siguiente consecutivo local de una resolución Jarvis.
   * Persiste el avance solo si el callback de emisión termina bien.
   */
  async allocateResolutionNumber(
    companyId: string,
    kind: JarvisResolutionKind,
  ): Promise<{
    prefix: string;
    number: number;
    toNumber: number;
    formNumber: string | null;
  }> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        trimmedCompanyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      throw new BadRequestException(
        'Complete primero la configuración inicial de la empresa.',
      );
    }

    const credentials = normalizeJarvisCredentials(integration.credentials);
    const current =
      kind === JarvisResolutionKind.SUPPORT_DOCUMENT
        ? credentials.resolutions?.support_document
        : credentials.resolutions?.electronic_invoice;

    if (!isJarvisResolutionConfigured(current)) {
      throw new BadRequestException(
        kind === JarvisResolutionKind.SUPPORT_DOCUMENT
          ? 'Configure primero la resolución de Documento soporte (número, prefijo y consecutivo).'
          : 'Configure primero la resolución de Factura electrónica (número, prefijo y consecutivo).',
      );
    }

    const number = getJarvisResolutionNextConsecutive(current);

    if (number == null || !current) {
      throw new BadRequestException(
        'Se agotó el rango de numeración de la resolución configurada.',
      );
    }

    if (!current.formNumber?.trim()) {
      throw new BadRequestException(
        'La resolución guardada no tiene número DIAN. Vuelva a configurar la resolución.',
      );
    }

    return {
      prefix: current.prefix.trim(),
      number,
      toNumber: current.toNumber,
      formNumber: current.formNumber.trim(),
    };
  }

  async commitResolutionNumber(
    companyId: string,
    kind: JarvisResolutionKind,
    usedNumber: number,
  ): Promise<void> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      return;
    }

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        trimmedCompanyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      return;
    }

    const credentials = normalizeJarvisCredentials(integration.credentials);
    const current =
      kind === JarvisResolutionKind.SUPPORT_DOCUMENT
        ? credentials.resolutions?.support_document
        : credentials.resolutions?.electronic_invoice;

    if (!current?.prefix?.trim()) {
      return;
    }

    const nextConsecutive = usedNumber + 1;
    const updated: JarvisDianResolution = {
      ...current,
      nextConsecutive,
      configuredAt: current.configuredAt ?? new Date().toISOString(),
    };

    integration.credentials = {
      ...credentials,
      resolutions: {
        ...credentials.resolutions,
        ...(kind === JarvisResolutionKind.SUPPORT_DOCUMENT
          ? { support_document: updated }
          : { electronic_invoice: updated }),
      },
    };

    await this.integrationsRepository.save(integration);
  }

  async getCredentialsStatus(
    companyId: string,
  ): Promise<JarvisCredentialsStatusResponseDto> {
    const trimmedCompanyId = companyId?.trim();

    if (!trimmedCompanyId) {
      throw new BadRequestException(
        'No se pudo determinar la empresa activa del usuario autenticado.',
      );
    }

    const subscription = await this.planSubscriptionService.getSubscription(
      trimmedCompanyId,
      IntegrationProvider.JARVIS,
    );

    const integration =
      await this.integrationsRepository.findByCompanyAndProvider(
        trimmedCompanyId,
        IntegrationProvider.JARVIS,
      );

    if (!integration) {
      return {
        configured: false,
        subscription,
        supportDocumentResolution: null,
        electronicInvoiceResolution: null,
        supportDocumentResolutionConfigured: false,
        electronicInvoiceResolutionConfigured: false,
      };
    }

    const credentials = normalizeJarvisCredentials(integration.credentials);
    const configured = areJarvisCredentialsConfigured(integration.credentials);
    const localSupport = credentials.resolutions?.support_document ?? null;
    const localInvoice = credentials.resolutions?.electronic_invoice ?? null;

    const nextPymeResolutions = await this.loadNextPymeResolutions();
    const supportDocumentResolution = this.mergeResolutionForStatus(
      localSupport,
      nextPymeResolutions.support,
      JarvisResolutionKind.SUPPORT_DOCUMENT,
      'DOCUMENTO SOPORTE',
    );
    const electronicInvoiceResolution = this.mergeResolutionForStatus(
      localInvoice,
      nextPymeResolutions.invoice,
      JarvisResolutionKind.ELECTRONIC_INVOICE,
      'FACTURA ELECTRÓNICA DE VENTA',
    );

    return {
      configured,
      subscription,
      business_name: credentials.business_name || undefined,
      trade_name: credentials.trade_name,
      economic_activity: credentials.economic_activity || undefined,
      tax_regime: credentials.tax_regime,
      vat_regime: credentials.vat_regime,
      tax_responsibility: credentials.tax_responsibility,
      country: credentials.country,
      department: credentials.department,
      municipality: credentials.municipality,
      city: credentials.city,
      email: credentials.email,
      address: credentials.address,
      phone: credentials.phone,
      configured_at: credentials.configured_at,
      supportDocumentResolution,
      electronicInvoiceResolution,
      supportDocumentResolutionConfigured: isJarvisResolutionConfigured(
        localSupport,
      ),
      electronicInvoiceResolutionConfigured: isJarvisResolutionConfigured(
        localInvoice,
      ),
    };
  }

  private async loadNextPymeResolutions(): Promise<{
    support: NextPymeResolution | null;
    invoice: NextPymeResolution | null;
  }> {
    try {
      const resolutions =
        await this.nextPymeMasterCatalogService.listResolutions();
      const supportTypeId =
        this.nextPymeMasterCatalogService.getSupportDocumentTypeId();
      const invoiceTypeId =
        this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId();

      return {
        support:
          resolutions.find((item) => item.type_document_id === supportTypeId) ??
          null,
        invoice:
          resolutions.find((item) => item.type_document_id === invoiceTypeId) ??
          null,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudieron consultar resoluciones en NextPyme: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { support: null, invoice: null };
    }
  }

  private mergeResolutionForStatus(
    local: JarvisDianResolution | null,
    remote: NextPymeResolution | null,
    kind: JarvisResolutionKind,
    fallbackLabel: string,
  ): JarvisDianResolution | null {
    if (!local && !remote) {
      return null;
    }

    const remoteMapped = this.mapNextPymeResolution(
      remote,
      kind,
      fallbackLabel,
    );
    const consecutive = getJarvisResolutionNextConsecutive(local);

    if (!local) {
      return remoteMapped;
    }

    return {
      ...(remoteMapped ?? {
        kind,
        documentTypeLabel: local.documentTypeLabel || fallbackLabel,
        prefix: local.prefix,
        fromNumber: local.fromNumber,
        toNumber: local.toNumber,
      }),
      kind,
      formNumber: local.formNumber ?? remoteMapped?.formNumber ?? null,
      nit: local.nit ?? remoteMapped?.nit ?? null,
      checkDigit: local.checkDigit ?? remoteMapped?.checkDigit ?? null,
      businessName: local.businessName ?? remoteMapped?.businessName ?? null,
      modalityCode: local.modalityCode ?? remoteMapped?.modalityCode ?? null,
      requestType: local.requestType ?? remoteMapped?.requestType ?? null,
      year: local.year ?? remoteMapped?.year ?? null,
      authorizedAt: local.authorizedAt ?? remoteMapped?.authorizedAt ?? null,
      technicalKey: local.technicalKey ?? remoteMapped?.technicalKey ?? null,
      dateFrom: local.dateFrom ?? remoteMapped?.dateFrom ?? null,
      dateTo: local.dateTo ?? remoteMapped?.dateTo ?? null,
      prefix: local.prefix,
      fromNumber: consecutive ?? local.fromNumber,
      toNumber: local.toNumber,
      nextConsecutive: consecutive ?? local.nextConsecutive ?? local.fromNumber,
      documentTypeLabel:
        local.documentTypeLabel ||
        remoteMapped?.documentTypeLabel ||
        fallbackLabel,
      configuredAt: local.configuredAt ?? remoteMapped?.configuredAt ?? null,
    };
  }

  private mapNextPymeResolution(
    item: NextPymeResolution | null,
    kind: JarvisResolutionKind,
    fallbackLabel: string,
  ): JarvisDianResolution | null {
    if (!item) {
      return null;
    }

    const fromNumber = Number(item.from ?? item.number);
    const toNumber = Number(item.to ?? item.from ?? item.number);

    if (!item.prefix?.trim() || !Number.isFinite(fromNumber)) {
      return null;
    }

    return {
      kind,
      formNumber: item.resolution ?? null,
      documentTypeLabel: item.type_document?.name?.trim() || fallbackLabel,
      prefix: item.prefix.trim(),
      fromNumber,
      toNumber: Number.isFinite(toNumber) ? toNumber : fromNumber,
      nextConsecutive: Number.isFinite(Number(item.number))
        ? Number(item.number)
        : fromNumber,
      authorizedAt: item.resolution_date ?? item.date_from ?? null,
      technicalKey: item.technical_key ?? null,
      dateFrom: item.date_from ?? null,
      dateTo: item.date_to ?? null,
      year: (item.resolution_date ?? item.date_from)?.slice(0, 4) ?? null,
      configuredAt: new Date().toISOString(),
    };
  }
}
