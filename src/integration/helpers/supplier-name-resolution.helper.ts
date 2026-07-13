import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';

export function resolveImportedSupplierName(
  normalizedNit: string,
  excelSupplierName: string,
  supplierNamesByNit: Map<string, string>,
): string {
  const configuredName = supplierNamesByNit.get(normalizedNit)?.trim();
  const excelName = excelSupplierName?.trim();

  return configuredName || excelName || '';
}

export function normalizeSupplierNit(identification: string): string {
  return normalizeSupplierDocument(identification);
}
