import { BadRequestException } from '@nestjs/common';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';

export const SIIGO_SUPPORT_DOCUMENT_RETENTION_TYPES = [
  'ReteICA',
  'Retefuente',
] as const;

export function normalizeSiigoTaxType(value?: string): string {
  return (value?.trim() ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function isAllowedSupportDocumentRetentionType(type?: string): boolean {
  const normalized = normalizeSiigoTaxType(type);

  return normalized === 'reteica' || normalized === 'retefuente';
}

export function validateSupportDocumentRetentions(
  retentionIds: number[],
  taxesCatalog: SiigoTaxCatalogItemDto[],
): Array<{ id: number }> {
  if (!retentionIds.length) {
    return [];
  }

  const taxesById = new Map(taxesCatalog.map((tax) => [tax.id, tax]));
  const mappedRetentions: Array<{ id: number }> = [];

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

    if (!isAllowedSupportDocumentRetentionType(tax.type)) {
      throw new BadRequestException(
        `El impuesto "${tax.name}" (tipo ${tax.type}) no es válido en Documento Soporte. Solo se permiten ReteICA y Retefuente.`,
      );
    }

    mappedRetentions.push({ id: retentionId });
  }

  return mappedRetentions;
}
