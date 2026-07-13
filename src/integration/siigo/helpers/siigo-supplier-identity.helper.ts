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

export function resolveSiigoSupplierIdentity(
  documentType?: string,
): ResolvedSiigoSupplierIdentity {
  const normalized = normalizeDocumentType(documentType);

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
