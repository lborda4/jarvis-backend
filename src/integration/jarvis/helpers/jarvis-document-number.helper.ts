import { JarvisDocumentType } from '../enums/jarvis-document-type.enum';

/**
 * Normaliza un número de documento (NIT/CC/CE/PA) a solo dígitos y letras,
 * en mayúsculas, sin puntos/guiones/espacios.
 */
export function normalizeJarvisDocumentNumber(value?: string | null): string {
  return (value ?? '')
    .replace(/[^\dA-Za-z]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Clasifica el tipo de documento de un proveedor a partir del
 * `documentType` almacenado en el payload del documento electrónico
 * (buscando "CC"/"CEDULA", "CE"/"EXTRANJ", "PA"/"PASAPORTE"; NIT por
 * defecto). Distinto de `normalizeSupportDocumentType`
 * (invoices/helpers/support-document-type.helper.ts), que además acepta
 * códigos DIAN numéricos y se usa para el tipo de documento digitado a mano
 * en el Excel de Documento Soporte.
 */
export function normalizeJarvisDocumentType(value?: string | null): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();

  if (normalized.includes('CC') || normalized.includes('CEDULA')) {
    return JarvisDocumentType.CC;
  }

  if (normalized.includes('CE') || normalized.includes('EXTRANJ')) {
    return JarvisDocumentType.CE;
  }

  if (normalized.includes('PA') || normalized.includes('PASAPORTE')) {
    return JarvisDocumentType.PA;
  }

  return JarvisDocumentType.NIT;
}
