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
  JarvisAvailableResolutionDto,
  ListJarvisAvailableResolutionsResponseDto,
  SaveJarvisResolutionRequestDto,
  SaveJarvisResolutionResponseDto,
} from './dto/jarvis-resolution.dto';
import {
  SaveJarvisCredentialsRequestDto,
  SaveJarvisCredentialsResponseDto,
} from './dto/save-jarvis-credentials.dto';
import {
  areJarvisCredentialsConfigured,
  ensureJarvisCreditNoteResolution,
  ensureJarvisDebitNoteResolution,
  ensureJarvisSupportCreditNoteResolution,
  getJarvisResolutionNextConsecutive,
  isJarvisResolutionConfigured,
  normalizeJarvisCredentials,
} from './helpers/jarvis-credentials.helper';
import { NextPymeMasterCatalogService } from './nextpyme/nextpyme-master-catalog.service';
import {
  NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID,
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

/** Normaliza fechas DIAN/NextPyme (ISO o YYYY-MM-DD) a AAAA-MM-DD. */
export function normalizeResolutionDate(
  value?: string | null,
): string | null {
  if (!value?.trim()) {
    return null;
  }

  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

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

  /** Rangos vigentes en NextPyme para los selectores de Factura de venta y
   * Documento soporte. Al elegir uno, `saveResolution` hace el PUT
   * /config/resolution con esos datos; si elige ambos, son dos PUTs. */
  async listAvailableResolutions(companyId?: string): Promise<ListJarvisAvailableResolutionsResponseDto> {
    const resolutions =
      await this.nextPymeMasterCatalogService.listResolutions(companyId);
    const today = new Date().toISOString().slice(0, 10);

    const available = resolutions
      .filter((item) => this.isResolutionActive(item, today))
      .map((item) => this.mapAvailableResolution(item));

    return { resolutions: available };
  }

  /** Vigente = hoy cae dentro del rango autorizado. Una resolución sin
   * fechas no se descarta: NextPyme no siempre las reporta y esconderla
   * dejaría al usuario sin nada que elegir. */
  private isResolutionActive(item: NextPymeResolution, today: string): boolean {
    const from = normalizeResolutionDate(item.date_from);
    const to = normalizeResolutionDate(item.date_to);

    if (from && today < from) {
      return false;
    }

    if (to && today > to) {
      return false;
    }

    return true;
  }

  private mapAvailableResolution(
    item: NextPymeResolution,
  ): JarvisAvailableResolutionDto {
    const fromNumber = Number(item.from ?? item.number);
    const toNumber = Number(item.to ?? fromNumber);
    const nextConsecutive = Number(item.next_consecutive ?? item.number);
    const rawTypeDocumentId = item.type_document?.id ?? item.type_document_id;
    const typeDocumentId =
      rawTypeDocumentId != null &&
      rawTypeDocumentId !== NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID
        ? rawTypeDocumentId
        : null;

    return {
      id: `${item.prefix}-${item.resolution ?? item.id}`,
      kind: this.kindFromTypeDocumentId(typeDocumentId),
      prefix: item.prefix,
      formNumber: item.resolution ?? null,
      fromNumber: Number.isFinite(fromNumber) ? fromNumber : 0,
      toNumber: Number.isFinite(toNumber) ? toNumber : 0,
      nextConsecutive: Number.isFinite(nextConsecutive)
        ? nextConsecutive
        : null,
      technicalKey: item.technical_key ?? null,
      authorizedAt: normalizeResolutionDate(item.resolution_date),
      dateFrom: normalizeResolutionDate(item.date_from),
      dateTo: normalizeResolutionDate(item.date_to),
      documentTypeLabel: item.type_document?.name?.trim() || null,
      typeDocumentId,
    };
  }

  private kindFromTypeDocumentId(
    typeDocumentId: number | null,
  ): JarvisResolutionKind | null {
    if (typeDocumentId === this.nextPymeMasterCatalogService.getSupportDocumentTypeId()) {
      return JarvisResolutionKind.SUPPORT_DOCUMENT;
    }

    if (
      typeDocumentId ===
      this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId()
    ) {
      return JarvisResolutionKind.ELECTRONIC_INVOICE;
    }

    return null;
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
    const requestedTechnicalKey = request.technicalKey?.trim();
    const dateFrom = normalizeResolutionDate(request.dateFrom);
    const dateTo = normalizeResolutionDate(request.dateTo);
    const resolutionDate =
      normalizeResolutionDate(request.authorizedAt) || dateFrom || undefined;
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

    // La clave de factura se resuelve más abajo: primero la de
    // integrations.credentials.technical_key (admin) y, si no hay, la del rango.

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

    // NextPyme PUT /config/resolution solo admite technical_key en factura
    // de venta (type_document_id 1). Es la misma llave con la que se
    // consultan los rangos (IDSoftware / credentials.technical_key), no la
    // TechnicalKey del rango DIAN. Documento soporte no la envía.
    const includeTechnicalKey =
      request.kind === JarvisResolutionKind.ELECTRONIC_INVOICE;
    const companyTechnicalKey =
      existing.technical_key?.trim() ||
      (await this.readSiigoTechnicalKey(trimmedCompanyId));
    const technicalKey = includeTechnicalKey
      ? companyTechnicalKey || requestedTechnicalKey
      : undefined;

    if (!technicalKey && request.kind === JarvisResolutionKind.ELECTRONIC_INVOICE) {
      throw new BadRequestException(
        'Configure la clave técnica de la empresa en Admin o elija un rango de factura que la traiga.',
      );
    }

    // El id "1"/"11" (SUPPORT_DOCUMENT_TYPE_ID / ELECTRONIC_INVOICE_TYPE_ID)
    // es un supuesto fijo, no un dato consultado — cuando el frontend ya
    // trae el type_document_id REAL que NextPyme reportó para esta
    // resolución puntual (ver GET resolutions/available y
    // JarvisAvailableResolutionDto.typeDocumentId), se usa ese en vez de
    // adivinar: si no coincide con lo que NextPyme tiene registrado para el
    // prefijo, el PUT /config/resolution lo rechaza (bug real reportado:
    // "No es posible guardar una clave técnica para este tipo de documento,
    // solo es posible para facturas electrónicas" al guardar la resolución
    // de factura de venta, porque el id fijo no era el que esa resolución
    // tenía en el catálogo real de NextPyme).
    // request.typeDocumentId puede llegar en 0 (NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID
    // — "NextPyme no informó un id real", ver mapAvailableResolution) — un
    // `??` normal lo hubiera dejado pasar como si fuera válido, causando el
    // mismo rechazo de NextPyme que este fix busca evitar.
    const hasRealTypeDocumentId =
      request.typeDocumentId != null &&
      request.typeDocumentId !== NEXTPYME_UNKNOWN_TYPE_DOCUMENT_ID;
    const typeDocumentId =
      (hasRealTypeDocumentId ? request.typeDocumentId : undefined) ??
      (request.kind === JarvisResolutionKind.DEBIT_NOTE ? 5 : request.kind === JarvisResolutionKind.CREDIT_NOTE ? 4 : request.kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE ? 13 : request.kind === JarvisResolutionKind.SUPPORT_DOCUMENT
        ? this.nextPymeMasterCatalogService.getSupportDocumentTypeId()
        : this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId());

    // PUT /config/resolution con los datos del rango elegido. Si NextPyme
    // rechaza, no persistimos: el error que ve el usuario es el de ellos.
    const companyToken = await this.nextPymeMasterCatalogService.requireCompanyToken(trimmedCompanyId);
    const nextPymePayload = {
      type_document_id: typeDocumentId,
      prefix,
      resolution: resolutionNumber,
      resolution_date: resolutionDate,
      ...(includeTechnicalKey && technicalKey
        ? { technical_key: technicalKey }
        : {}),
      from: fromNumber,
      to: toNumber,
      generated_to_date: 0,
      date_from: dateFrom,
      date_to: dateTo,
    };
    this.logger.log(
      `[saveResolution] company=${trimmedCompanyId} kind=${request.kind} PUT /config/resolution`,
    );
    const nextPymeResponse = await this.nextPymeApiClient.putConfigResolution(
      nextPymePayload,
      companyToken,
    );
    this.logger.log(
      `[saveResolution] company=${trimmedCompanyId} kind=${request.kind} NextPyme respondió ${JSON.stringify(
        nextPymeResponse,
        null,
        2,
      )}`,
    );

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
      technicalKey: includeTechnicalKey ? technicalKey : null,
      dateFrom,
      dateTo,
      configuredAt: new Date().toISOString(),
    };

    const credentials: JarvisCredentials = {
      ...existing,
      ...(technicalKey && includeTechnicalKey
        ? { technical_key: technicalKey }
        : {}),
      resolutions: {
        ...existing.resolutions,
        ...(request.kind === JarvisResolutionKind.DEBIT_NOTE ? { debit_note: localResolution } : request.kind === JarvisResolutionKind.CREDIT_NOTE ? { credit_note: localResolution } : request.kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE ? { support_credit_note: localResolution } : request.kind === JarvisResolutionKind.SUPPORT_DOCUMENT
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
   * Reserva el siguiente consecutivo de la resolución ya configurada.
   * No vuelve a hacer PUT a NextPyme: eso ocurre solo al guardar en Configuración.
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
      kind === JarvisResolutionKind.DEBIT_NOTE ? credentials.resolutions?.debit_note : kind === JarvisResolutionKind.CREDIT_NOTE ? credentials.resolutions?.credit_note : kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE ? credentials.resolutions?.support_credit_note : kind === JarvisResolutionKind.SUPPORT_DOCUMENT
        ? credentials.resolutions?.support_document
        : credentials.resolutions?.electronic_invoice;

    if (
      kind === JarvisResolutionKind.CREDIT_NOTE ||
      kind === JarvisResolutionKind.DEBIT_NOTE ||
      kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE
    ) {
      const numbering =
        kind === JarvisResolutionKind.CREDIT_NOTE
          ? ensureJarvisCreditNoteResolution(current)
          : kind === JarvisResolutionKind.DEBIT_NOTE
            ? ensureJarvisDebitNoteResolution(current)
            : ensureJarvisSupportCreditNoteResolution(current);
      if (!current?.prefix?.trim()) {
        integration.credentials = {
          ...credentials,
          resolutions: {
            ...credentials.resolutions,
            ...(kind === JarvisResolutionKind.CREDIT_NOTE
              ? { credit_note: numbering }
              : kind === JarvisResolutionKind.DEBIT_NOTE
                ? { debit_note: numbering }
                : { support_credit_note: numbering }),
          },
        };
        await this.integrationsRepository.save(integration);
      }

      const number = getJarvisResolutionNextConsecutive(numbering);
      if (number == null) {
        throw new BadRequestException(
          kind === JarvisResolutionKind.CREDIT_NOTE
            ? 'Se agotó el rango de numeración de nota crédito.'
            : kind === JarvisResolutionKind.DEBIT_NOTE
              ? 'Se agotó el rango de numeración de nota débito.'
              : 'Se agotó el rango de numeración de nota de ajuste.',
        );
      }

      return {
        prefix: numbering.prefix.trim(),
        number,
        toNumber: numbering.toNumber,
        formNumber: numbering.formNumber?.trim() || null,
      };
    }

    if (!isJarvisResolutionConfigured(current)) {
      throw new BadRequestException(
        kind === JarvisResolutionKind.SUPPORT_DOCUMENT
          ? 'Configure primero la resolución de Documento soporte (número, prefijo y consecutivo).'
          : 'Configure primero la resolución de Factura electrónica (número, prefijo y consecutivo).',
      );
    }

    const number = getJarvisResolutionNextConsecutive(current);

    if (number == null) {
      throw new BadRequestException(
        'Se agotó el rango de numeración de la resolución configurada.',
      );
    }

    if (!current!.formNumber?.trim()) {
      throw new BadRequestException(
        'La resolución guardada no tiene número DIAN. Vuelva a configurar la resolución.',
      );
    }

    return {
      prefix: current!.prefix.trim(),
      number,
      toNumber: current!.toNumber,
      formNumber: current!.formNumber.trim(),
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
      kind === JarvisResolutionKind.DEBIT_NOTE
        ? ensureJarvisDebitNoteResolution(credentials.resolutions?.debit_note)
        : kind === JarvisResolutionKind.CREDIT_NOTE
          ? ensureJarvisCreditNoteResolution(
              credentials.resolutions?.credit_note,
            )
        : kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE
          ? ensureJarvisSupportCreditNoteResolution(
              credentials.resolutions?.support_credit_note,
            )
        : kind === JarvisResolutionKind.SUPPORT_DOCUMENT
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
        ...(kind === JarvisResolutionKind.DEBIT_NOTE ? { debit_note: updated } : kind === JarvisResolutionKind.CREDIT_NOTE ? { credit_note: updated } : kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE ? { support_credit_note: updated } : kind === JarvisResolutionKind.SUPPORT_DOCUMENT
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

    const nextPymeResolutions = await this.loadNextPymeResolutions(
      trimmedCompanyId,
      localSupport,
      localInvoice,
    );
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
      debitNoteResolution: ensureJarvisDebitNoteResolution(
        credentials.resolutions?.debit_note,
      ),
      creditNoteResolution: ensureJarvisCreditNoteResolution(
        credentials.resolutions?.credit_note,
      ),
      supportCreditNoteResolution: ensureJarvisSupportCreditNoteResolution(
        credentials.resolutions?.support_credit_note,
      ),
      supportDocumentResolutionConfigured: isJarvisResolutionConfigured(
        localSupport,
      ),
      electronicInvoiceResolutionConfigured: isJarvisResolutionConfigured(
        localInvoice,
      ),
    };
  }

  private async loadNextPymeResolutions(
    companyId: string,
    localSupport: JarvisDianResolution | null,
    localInvoice: JarvisDianResolution | null,
  ): Promise<{
    support: NextPymeResolution | null;
    invoice: NextPymeResolution | null;
  }> {
    try {
      const resolutions =
        await this.nextPymeMasterCatalogService.listResolutions(companyId);
      const supportTypeId =
        this.nextPymeMasterCatalogService.getSupportDocumentTypeId();
      const invoiceTypeId =
        this.nextPymeMasterCatalogService.getElectronicInvoiceTypeId();

      return {
        support: this.pickRemoteResolution(
          resolutions,
          supportTypeId,
          localSupport,
        ),
        invoice: this.pickRemoteResolution(
          resolutions,
          invoiceTypeId,
          localInvoice,
        ),
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

  private pickRemoteResolution(
    resolutions: NextPymeResolution[],
    typeDocumentId: number,
    local: JarvisDianResolution | null,
  ): NextPymeResolution | null {
    const ofType = resolutions.filter(
      (item) => item.type_document_id === typeDocumentId,
    );
    const prefix = local?.prefix?.trim().toUpperCase();
    const formNumber = local?.formNumber?.trim();

    if (prefix && formNumber) {
      const exact = ofType.find(
        (item) =>
          String(item.prefix ?? '')
            .trim()
            .toUpperCase() === prefix &&
          String(item.resolution ?? '').trim() === formNumber,
      );
      if (exact) {
        return exact;
      }
    }

    return ofType[0] ?? null;
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

  private async readSiigoTechnicalKey(companyId: string): Promise<string | undefined> {
    const siigo = await this.integrationsRepository.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.SIIGO,
    );
    if (!siigo?.credentials || typeof siigo.credentials !== 'object') {
      return undefined;
    }

    const raw = siigo.credentials as Record<string, unknown>;
    const value = String(raw.technical_key ?? raw.technicalKey ?? '').trim();
    return value || undefined;
  }
}
