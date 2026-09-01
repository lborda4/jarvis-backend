import { SupplierItemAccountMapping } from '../entities/supplier-item-account-mapping.entity';
import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';

/**
 * Normalización de la descripción de un ítem para usarla como clave de
 * mapeo — las descripciones ya vienen limpias y consistentes desde la
 * fuente (SIIGO/NextPyme), así que a propósito NO se aplica normalización
 * agresiva (no se quitan números, no hay fuzzy matching ni distancia de
 * edición): solo minúsculas y colapsar espacios múltiples, para tolerar
 * diferencias triviales de capitalización/espaciado sin arriesgar juntar
 * dos conceptos que en realidad son distintos.
 */
export function normalizeItemDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Misma forma que buildSupplierConfigurationKey (supplier-accounts-catalog.helper.ts),
 * con la descripción normalizada agregada al final de la clave. */
export function buildSupplierItemAccountMappingKey(
  companyId: string,
  integrationId: string,
  supplierDocumentType: string,
  supplierDocument: string,
  description: string,
): string {
  return [
    companyId,
    integrationId,
    supplierDocumentType.trim() || 'NIT',
    normalizeSupplierDocument(supplierDocument),
    normalizeItemDescription(description),
  ].join('|');
}

export function indexSupplierItemAccountMappings(
  mappings: SupplierItemAccountMapping[],
): Map<string, SupplierItemAccountMapping> {
  const indexed = new Map<string, SupplierItemAccountMapping>();

  for (const mapping of mappings) {
    const normalizedDocument = normalizeSupplierDocument(
      mapping.supplierDocument,
    );

    if (!normalizedDocument) {
      continue;
    }

    indexed.set(
      buildSupplierItemAccountMappingKey(
        mapping.companyId,
        mapping.integrationId,
        mapping.supplierDocumentType,
        normalizedDocument,
        mapping.descriptionNormalized,
      ),
      mapping,
    );
  }

  return indexed;
}
