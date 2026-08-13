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
