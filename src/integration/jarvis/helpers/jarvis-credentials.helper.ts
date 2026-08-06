import {
  IntegrationCredentials,
  JarvisCredentials,
  JarvisDianResolution,
} from '../../interfaces/integration-credentials.interface';
import { JarvisResolutionKind } from '../enums/jarvis-resolution-kind.enum';
import { JarvisTaxRegime } from '../enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../enums/jarvis-vat-regime.enum';

const JARVIS_TAX_REGIMES = new Set<string>(Object.values(JarvisTaxRegime));
const JARVIS_VAT_REGIMES = new Set<string>(Object.values(JarvisVatRegime));
const JARVIS_TAX_RESPONSIBILITIES = new Set<string>(
  Object.values(JarvisTaxResponsibility),
);

function readString(
  raw: Record<string, unknown>,
  snake: string,
  camel: string,
): string {
  return String(raw[snake] ?? raw[camel] ?? '').trim();
}

function readOptionalString(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeResolution(
  value: unknown,
  fallbackKind: JarvisResolutionKind,
): JarvisDianResolution | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const prefix = readOptionalString(raw.prefix);
  const documentTypeLabel = readOptionalString(
    raw.documentTypeLabel ?? raw.document_type_label,
  );
  const fromNumber = Number(raw.fromNumber ?? raw.from_number);
  const toNumber = Number(raw.toNumber ?? raw.to_number);

  if (
    !prefix ||
    !documentTypeLabel ||
    !Number.isFinite(fromNumber) ||
    !Number.isFinite(toNumber)
  ) {
    return undefined;
  }

  const kindValue = String(raw.kind ?? fallbackKind);
  const kind = Object.values(JarvisResolutionKind).includes(
    kindValue as JarvisResolutionKind,
  )
    ? (kindValue as JarvisResolutionKind)
    : fallbackKind;

  return {
    kind,
    formNumber: readOptionalString(raw.formNumber ?? raw.form_number),
    nit: readOptionalString(raw.nit),
    checkDigit: readOptionalString(raw.checkDigit ?? raw.check_digit),
    businessName: readOptionalString(raw.businessName ?? raw.business_name),
    documentTypeLabel,
    modalityCode: readOptionalString(raw.modalityCode ?? raw.modality_code),
    prefix,
    fromNumber,
    toNumber,
    nextConsecutive: Number.isFinite(
      Number(raw.nextConsecutive ?? raw.next_consecutive),
    )
      ? Number(raw.nextConsecutive ?? raw.next_consecutive)
      : fromNumber,
    requestType: readOptionalString(raw.requestType ?? raw.request_type),
    year: readOptionalString(raw.year),
    authorizedAt: readOptionalString(raw.authorizedAt ?? raw.authorized_at),
    technicalKey: readOptionalString(raw.technicalKey ?? raw.technical_key),
    dateFrom: readOptionalString(raw.dateFrom ?? raw.date_from),
    dateTo: readOptionalString(raw.dateTo ?? raw.date_to),
    configuredAt: readOptionalString(raw.configuredAt ?? raw.configured_at),
  };
}

export function normalizeJarvisCredentials(
  credentials: IntegrationCredentials,
): JarvisCredentials {
  const raw = credentials as unknown as Record<string, unknown>;

  const taxRegime = readString(raw, 'tax_regime', 'taxRegime');
  const vatRegime = readString(raw, 'vat_regime', 'vatRegime');
  const taxResponsibility = readString(
    raw,
    'tax_responsibility',
    'taxResponsibility',
  );

  const resolutionsRaw =
    raw.resolutions && typeof raw.resolutions === 'object'
      ? (raw.resolutions as Record<string, unknown>)
      : {};

  const supportDocument = normalizeResolution(
    resolutionsRaw.support_document ?? resolutionsRaw.supportDocument,
    JarvisResolutionKind.SUPPORT_DOCUMENT,
  );
  const electronicInvoice = normalizeResolution(
    resolutionsRaw.electronic_invoice ?? resolutionsRaw.electronicInvoice,
    JarvisResolutionKind.ELECTRONIC_INVOICE,
  );

  return {
    business_name: readString(raw, 'business_name', 'businessName'),
    trade_name: readString(raw, 'trade_name', 'tradeName') || undefined,
    economic_activity: readString(raw, 'economic_activity', 'economicActivity'),
    tax_regime: JARVIS_TAX_REGIMES.has(taxRegime)
      ? (taxRegime as JarvisTaxRegime)
      : undefined,
    vat_regime: JARVIS_VAT_REGIMES.has(vatRegime)
      ? (vatRegime as JarvisVatRegime)
      : undefined,
    tax_responsibility: JARVIS_TAX_RESPONSIBILITIES.has(taxResponsibility)
      ? (taxResponsibility as JarvisTaxResponsibility)
      : undefined,
    country: readString(raw, 'country', 'country') || undefined,
    department: readString(raw, 'department', 'department') || undefined,
    municipality: readString(raw, 'municipality', 'municipality') || undefined,
    city: readString(raw, 'city', 'city') || undefined,
    email: readString(raw, 'email', 'email') || undefined,
    address: readString(raw, 'address', 'address') || undefined,
    phone: readString(raw, 'phone', 'phone') || undefined,
    configured_at: raw.configured_at
      ? String(raw.configured_at)
      : raw.configuredAt
        ? String(raw.configuredAt)
        : undefined,
    resolutions:
      supportDocument || electronicInvoice
        ? {
            ...(supportDocument
              ? { support_document: supportDocument }
              : {}),
            ...(electronicInvoice
              ? { electronic_invoice: electronicInvoice }
              : {}),
          }
        : undefined,
  };
}

export function isJarvisResolutionConfigured(
  resolution?: JarvisDianResolution | null,
): boolean {
  const consecutive = Number(
    resolution?.nextConsecutive ?? resolution?.fromNumber,
  );

  return Boolean(
    resolution?.prefix?.trim() &&
      resolution?.formNumber?.trim() &&
      Number.isFinite(consecutive) &&
      consecutive >= 1 &&
      (!Number.isFinite(resolution.toNumber) ||
        consecutive <= resolution.toNumber),
  );
}

export function getJarvisResolutionNextConsecutive(
  resolution?: JarvisDianResolution | null,
): number | null {
  if (!resolution?.prefix?.trim()) {
    return null;
  }

  const consecutive = Number(
    resolution.nextConsecutive ?? resolution.fromNumber,
  );

  if (!Number.isFinite(consecutive) || consecutive < 1) {
    return null;
  }

  if (
    Number.isFinite(resolution.toNumber) &&
    consecutive > resolution.toNumber
  ) {
    return null;
  }

  return consecutive;
}

export function areJarvisCredentialsConfigured(
  credentials: IntegrationCredentials,
): boolean {
  const normalized = normalizeJarvisCredentials(credentials);

  return Boolean(
    normalized.business_name &&
      normalized.economic_activity &&
      normalized.tax_regime &&
      normalized.vat_regime &&
      normalized.tax_responsibility &&
      normalized.country &&
      normalized.department &&
      normalized.municipality &&
      normalized.city &&
      normalized.email &&
      normalized.address &&
      normalized.phone,
  );
}

/**
 * Builds Jarvis credentials from a RUT/admin seed payload.
 * Only sets configured_at when all required fields are present.
 */
export function buildJarvisCredentialsSeed(
  input: IntegrationCredentials | Record<string, unknown>,
): JarvisCredentials {
  const normalized = normalizeJarvisCredentials(input as IntegrationCredentials);
  const complete = areJarvisCredentialsConfigured(normalized);

  return {
    ...normalized,
    configured_at: complete
      ? normalized.configured_at || new Date().toISOString()
      : undefined,
  };
}
