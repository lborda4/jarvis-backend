import { BadRequestException } from '@nestjs/common';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';

export const SIIGO_SUPPORT_DOCUMENT_RETENTION_TYPES = [
  'ReteICA',
  'ReteIVA',
  'Autorretención',
  'Retefuente',
] as const;

export interface SupportDocumentRetentionPlacement {
  documentRetentions: Array<{ id: number }>;
  itemRetentionIds: number[];
}

export function normalizeSiigoTaxType(value?: string): string {
  return (value?.trim() ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function isDocumentLevelSupportDocumentRetentionType(
  type?: string,
): boolean {
  const normalized = normalizeSiigoTaxType(type);

  return (
    normalized === 'reteica' ||
    normalized === 'reteiva' ||
    normalized === 'autorretencion'
  );
}

export function isItemLevelSupportDocumentRetentionType(type?: string): boolean {
  return normalizeSiigoTaxType(type) === 'retefuente';
}

export function isAllowedSupportDocumentRetentionType(type?: string): boolean {
  return (
    isDocumentLevelSupportDocumentRetentionType(type) ||
    isItemLevelSupportDocumentRetentionType(type)
  );
}

export function resolveSupportDocumentRetentionPlacement(
  retentionIds: number[],
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SupportDocumentRetentionPlacement {
  if (!retentionIds.length) {
    return { documentRetentions: [], itemRetentionIds: [] };
  }

  const taxesById = new Map(taxesCatalog.map((tax) => [tax.id, tax]));
  const documentRetentions: Array<{ id: number }> = [];
  const itemRetentionIds: number[] = [];

  for (const retentionId of retentionIds) {
    if (!Number.isFinite(retentionId) || retentionId <= 0) {
      continue;
    }

    const tax = taxesById.get(retentionId);

    if (!tax) {
      throw new BadRequestException(
        `El impuesto con id ${retentionId} no existe en el catálogo de SIIGO.`,
      );
    }

    if (isDocumentLevelSupportDocumentRetentionType(tax.type)) {
      documentRetentions.push({ id: retentionId });
      continue;
    }

    if (isItemLevelSupportDocumentRetentionType(tax.type)) {
      itemRetentionIds.push(retentionId);
      continue;
    }

    throw new BadRequestException(
      `El impuesto "${tax.name}" (tipo ${tax.type}) no es una retención válida. Se permiten ReteICA, ReteIVA, Autorretención (a nivel documento) y Retefuente (a nivel ítem).`,
    );
  }

  return { documentRetentions, itemRetentionIds };
}

export function validateSupportDocumentRetentions(
  retentionIds: number[],
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SupportDocumentRetentionPlacement {
  return resolveSupportDocumentRetentionPlacement(retentionIds, taxesCatalog);
}

/** Código DIAN (tabla de "tipo de retención" del UBL WithholdingTaxTotal) →
 * tipo interno — confirmado contra respuestas reales de NextPyme (05,06,07);
 * el `tax_name` que trae NextPyme para el mismo código varía (ej. "ReteRenta"
 * vs "ReteFuente" para 06), por eso el match usa el código, nunca el nombre.
 * Autorretención no tiene código confirmado todavía — si aparece, simplemente
 * no matchea nada (no se adivina). */
const DIAN_WITHHOLDING_CODE_TO_TYPE: Record<string, string> = {
  '05': 'ReteIVA',
  '06': 'Retefuente',
  '07': 'ReteICA',
};

const RETENTION_MATCH_TOLERANCE = 0.01;

export interface SuggestedRetentionFromInvoice {
  id: number;
  name: string;
  type: string;
  percentage: number;
}

/**
 * Retenciones que el VENDEDOR ya certificó en la factura DIAN original
 * (NextPyme `with_holding_tax_totals`), cruzadas contra el catálogo de
 * impuestos de SIIGO de la empresa por tipo (código DIAN) + porcentaje. Es
 * un dato específico de ESTA factura (no un patrón histórico del
 * proveedor) — pensado como ÚLTIMO fallback, cuando ni el historial
 * confirmado ni una preferencia guardada resolvieron nada, en vez de dejar
 * la retención completamente vacía a pesar de que la factura sí la trae
 * (bug real reportado: "no subió ninguna retención así tuviera imp renta").
 * Si el porcentaje no matchea ningún impuesto real del catálogo, esa
 * retención puntual simplemente no se sugiere — nunca se adivina.
 */
export function resolveSuggestedRetentionsFromInvoice(
  withholdings: Array<{ dianTaxCode: string; percentage: number }> | undefined,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SuggestedRetentionFromInvoice[] {
  if (!withholdings?.length) {
    return [];
  }

  const results: SuggestedRetentionFromInvoice[] = [];

  for (const withholding of withholdings) {
    const dianType = DIAN_WITHHOLDING_CODE_TO_TYPE[withholding.dianTaxCode];

    if (!dianType) {
      continue;
    }

    const normalizedDianType = normalizeSiigoTaxType(dianType);
    const match = taxesCatalog.find(
      (tax) =>
        tax.active !== false &&
        normalizeSiigoTaxType(tax.type) === normalizedDianType &&
        Math.abs(tax.percentage - withholding.percentage) < RETENTION_MATCH_TOLERANCE,
    );

    if (match) {
      results.push({
        id: match.id,
        name: match.name,
        type: match.type,
        percentage: match.percentage,
      });
    }
  }

  return results;
}
