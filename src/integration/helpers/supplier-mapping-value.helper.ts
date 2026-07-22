import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../interfaces/supplier-mapping-value.interface';

export function normalizeSupplierPaymentMethodPreference(
  value: unknown,
): SupplierPaymentMethodPreference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SupplierPaymentMethodPreference>;
  const id = Number(candidate.id);

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    name: candidate.name?.trim() || `Medio ${id}`,
    type: candidate.type?.trim() || '',
    ...(candidate.dueDate === undefined
      ? {}
      : { dueDate: Boolean(candidate.dueDate) }),
  };
}

export function normalizeSupplierCostCenterPreference(
  value: unknown,
): SupplierCostCenterPreference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SupplierCostCenterPreference>;
  const id = Number(candidate.id);

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  return {
    id,
    code: candidate.code?.trim() || String(id),
    name: candidate.name?.trim() || `Centro ${id}`,
  };
}

export function normalizeSupplierRetentionPreferences(
  value: unknown,
): SupplierRetentionPreference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const retentionsById = new Map<number, SupplierRetentionPreference>();

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const candidate = item as Partial<SupplierRetentionPreference>;
    const id = Number(candidate.id);

    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }

    retentionsById.set(id, {
      id,
      name: candidate.name?.trim() || `Retención ${id}`,
      type: candidate.type?.trim() || '',
      percentage: Number.isFinite(Number(candidate.percentage))
        ? Number(candidate.percentage)
        : 0,
    });
  }

  return [...retentionsById.values()];
}
