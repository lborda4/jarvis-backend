import {
  SIIGO_CEDULA_ID_TYPE,
  SIIGO_COMPANY_PERSON_TYPE,
  SIIGO_NIT_ID_TYPE,
  SIIGO_PERSON_PERSON_TYPE,
} from '../constants/siigo.constants';

const NATURAL_PERSON_DOCUMENT_TYPES = new Set([
  '13',
  'CC',
  'CEDULA',
  'CÉDULA',
  'CEDULA DE CIUDADANIA',
  'CEDULA DE CIUDADANÍA',
  'CI',
  'PERSON',
]);

const COMPANY_DOCUMENT_TYPES = new Set([
  '31',
  'NIT',
  'COMPANY',
  'RUT',
]);

export interface ResolvedSiigoSupplierIdentity {
  personType: string;
  idType: string;
  documentTypeLabel: string;
}

export function normalizeSiigoPersonType(
  personType?: string | null,
): string | null {
  const normalized = personType?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === 'person' || normalized === 'persona') {
    return SIIGO_PERSON_PERSON_TYPE;
  }

  if (
    normalized === 'company' ||
    normalized === 'empresa' ||
    normalized === 'juridica' ||
    normalized === 'jurídica'
  ) {
    return SIIGO_COMPANY_PERSON_TYPE;
  }

  if (normalized === SIIGO_PERSON_PERSON_TYPE.toLowerCase()) {
    return SIIGO_PERSON_PERSON_TYPE;
  }

  if (normalized === SIIGO_COMPANY_PERSON_TYPE.toLowerCase()) {
    return SIIGO_COMPANY_PERSON_TYPE;
  }

  return null;
}

export function resolveSiigoSupplierIdentity(params?: {
  documentType?: string;
  personType?: string | null;
}): ResolvedSiigoSupplierIdentity {
  const forcedPersonType = normalizeSiigoPersonType(params?.personType);

  if (forcedPersonType === SIIGO_PERSON_PERSON_TYPE) {
    return {
      personType: SIIGO_PERSON_PERSON_TYPE,
      idType: SIIGO_CEDULA_ID_TYPE,
      documentTypeLabel: 'CC',
    };
  }

  if (forcedPersonType === SIIGO_COMPANY_PERSON_TYPE) {
    return {
      personType: SIIGO_COMPANY_PERSON_TYPE,
      idType: SIIGO_NIT_ID_TYPE,
      documentTypeLabel: 'NIT',
    };
  }

  const normalized = normalizeDocumentType(params?.documentType);

  if (isNaturalPersonDocumentType(normalized)) {
    return {
      personType: SIIGO_PERSON_PERSON_TYPE,
      idType: SIIGO_CEDULA_ID_TYPE,
      documentTypeLabel: 'CC',
    };
  }

  if (isCompanyDocumentType(normalized)) {
    return {
      personType: SIIGO_COMPANY_PERSON_TYPE,
      idType: SIIGO_NIT_ID_TYPE,
      documentTypeLabel: 'NIT',
    };
  }

  return {
    personType: SIIGO_COMPANY_PERSON_TYPE,
    idType: SIIGO_NIT_ID_TYPE,
    documentTypeLabel: 'NIT',
  };
}

export function mapDocumentTypeLabelFromSiigoIdType(idType: string): string {
  if (idType === SIIGO_CEDULA_ID_TYPE) {
    return 'CC';
  }

  if (idType === SIIGO_NIT_ID_TYPE) {
    return 'NIT';
  }

  return idType;
}

export function buildSiigoCustomerName(
  fullName: string,
  personType: string,
): string[] {
  const trimmed = fullName.trim();

  if (!trimmed) {
    return ['Proveedor'];
  }

  if (personType === SIIGO_PERSON_PERSON_TYPE) {
    const parts = trimmed.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return [parts[0], parts.slice(1).join(' ')];
    }

    return [trimmed, trimmed];
  }

  return [trimmed];
}

function normalizeDocumentType(documentType?: string): string {
  return documentType?.trim().toUpperCase().replace(/\s+/g, ' ') || '';
}

function isNaturalPersonDocumentType(normalized: string): boolean {
  return NATURAL_PERSON_DOCUMENT_TYPES.has(normalized);
}

function isCompanyDocumentType(normalized: string): boolean {
  return COMPANY_DOCUMENT_TYPES.has(normalized);
}
