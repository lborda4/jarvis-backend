import {
  IntegrationCredentials,
  SiigoCredentials,
  SiigoDocumentTypeSelection,
} from '../../interfaces/integration-credentials.interface';
import { isValidSiigoConfigurationId } from './siigo-document-type.helper';

function normalizeDocumentTypes(
  raw: unknown,
): SiigoDocumentTypeSelection | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const supportRaw =
    value.support_document_id ??
    value.supportDocumentId ??
    value.support_documentTypeId;
  const purchaseRaw =
    value.purchase_invoice_id ??
    value.purchaseInvoiceId ??
    value.purchase_invoiceTypeId;

  const support_document_id = Number(supportRaw);
  const purchase_invoice_id = Number(purchaseRaw);

  const documentTypes: SiigoDocumentTypeSelection = {};

  if (isValidSiigoConfigurationId(support_document_id)) {
    documentTypes.support_document_id = support_document_id;
  }

  if (isValidSiigoConfigurationId(purchase_invoice_id)) {
    documentTypes.purchase_invoice_id = purchase_invoice_id;
  }

  return Object.keys(documentTypes).length > 0 ? documentTypes : undefined;
}

export function normalizeSiigoCredentials(
  credentials: IntegrationCredentials,
): SiigoCredentials {
  const raw = credentials as unknown as Record<string, unknown>;

  return {
    username: String(raw.username ?? ''),
    access_key: String(raw.access_key ?? raw.accessKey ?? ''),
    partner_id: raw.partner_id
      ? String(raw.partner_id)
      : raw.partnerId
        ? String(raw.partnerId)
        : undefined,
    token: raw.token
      ? String(raw.token)
      : raw.accessToken
        ? String(raw.accessToken)
        : undefined,
    expires_at: raw.expires_at
      ? String(raw.expires_at)
      : raw.expiresAt
        ? String(raw.expiresAt)
        : undefined,
    document_types: normalizeDocumentTypes(
      raw.document_types ?? raw.documentTypes,
    ),
  };
}

export interface SiigoEnvCredentials {
  username?: string;
  accessKey?: string;
  partnerId?: string;
}

export function resolveSiigoCredentials(
  credentials: SiigoCredentials,
  envDefaults: SiigoEnvCredentials = {},
): SiigoCredentials {
  const username = credentials.username || envDefaults.username;
  const access_key = credentials.access_key || envDefaults.accessKey;
  const partner_id = credentials.partner_id || envDefaults.partnerId || undefined;

  if (!username || !access_key) {
    throw new Error(
      'Faltan credenciales SIIGO. Configure username y access_key en Integration o en variables de entorno.',
    );
  }

  return {
    ...credentials,
    username,
    access_key,
    partner_id,
  };
}

export function areSiigoCredentialsConfigured(
  credentials: IntegrationCredentials,
): boolean {
  const normalized = normalizeSiigoCredentials(credentials);

  return Boolean(normalized.username.trim() && normalized.access_key.trim());
}

export function areSiigoDocumentTypesConfigured(
  credentials: IntegrationCredentials,
  includedDocumentTypes: readonly string[],
): boolean {
  const needsSupport = includedDocumentTypes.includes('SUPPORT_DOCUMENT');
  const needsPurchase = includedDocumentTypes.includes('PURCHASE_INVOICE');

  if (!needsSupport && !needsPurchase) {
    return true;
  }

  const documentTypes = normalizeSiigoCredentials(credentials).document_types;

  if (needsSupport && !isValidSiigoConfigurationId(documentTypes?.support_document_id)) {
    return false;
  }

  if (
    needsPurchase &&
    !isValidSiigoConfigurationId(documentTypes?.purchase_invoice_id)
  ) {
    return false;
  }

  return true;
}
