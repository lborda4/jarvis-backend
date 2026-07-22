import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { isAllowedAccountCode, SuggestedAccount } from './supplier-accounts-catalog.helper';
import {
  SupplierCostCenterPreference,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../interfaces/supplier-mapping-value.interface';
import { SupplierPreferenceSnapshot } from '../interfaces/supplier-preference.interface';
import { normalizeSupplierCostCenterPreference } from './supplier-mapping-value.helper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeSupplierPreferenceSnapshot(
  value: unknown,
): SupplierPreferenceSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const account = value.account;

  if (!isRecord(account)) {
    return null;
  }

  const accountCode = String(account.code ?? '').trim();
  const accountName = String(account.name ?? '').trim();

  if (!accountCode) {
    return null;
  }

  const paymentMethod = value.paymentMethod;
  let normalizedPaymentMethod: SupplierPaymentMethodPreference | null | undefined;

  if (paymentMethod === undefined) {
    normalizedPaymentMethod = undefined;
  } else if (paymentMethod === null) {
    normalizedPaymentMethod = null;
  } else if (isRecord(paymentMethod)) {
    const paymentMethodId = Number(paymentMethod.id);

    if (!Number.isFinite(paymentMethodId) || paymentMethodId <= 0) {
      normalizedPaymentMethod = null;
    } else {
      normalizedPaymentMethod = {
        id: paymentMethodId,
        name:
          String(paymentMethod.name ?? '').trim() || `Medio ${paymentMethodId}`,
        type: String(paymentMethod.type ?? '').trim(),
        ...(paymentMethod.dueDate === undefined
          ? {}
          : { dueDate: Boolean(paymentMethod.dueDate) }),
      };
    }
  } else {
    return null;
  }

  const rawRetentions = Array.isArray(value.retentions) ? value.retentions : [];
  const retentions = rawRetentions
    .map((retention): SupplierRetentionPreference | null => {
      if (!isRecord(retention)) {
        return null;
      }

      const id = Number(retention.id);

      if (!Number.isFinite(id) || id <= 0) {
        return null;
      }

      return {
        id,
        name: String(retention.name ?? '').trim() || `Retención ${id}`,
        type: String(retention.type ?? '').trim(),
        percentage: Number(retention.percentage ?? 0),
      };
    })
    .filter((retention): retention is SupplierRetentionPreference => retention !== null);

  return {
    account: {
      code: accountCode,
      name: accountName || accountCode,
    },
    ...(normalizedPaymentMethod !== undefined
      ? { paymentMethod: normalizedPaymentMethod }
      : {}),
    retentions,
    ...(value.costCenter !== undefined
      ? {
          costCenter: normalizeSupplierCostCenterPreference(value.costCenter),
        }
      : {}),
  };
}

export function resolveSuggestedAccountFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SuggestedAccount | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(configuration?.preference);

  if (!snapshot || !isAllowedAccountCode(snapshot.account.code)) {
    return null;
  }

  return {
    code: snapshot.account.code,
    name: snapshot.account.name,
    uses: 1,
  };
}

export function resolveSuggestedPaymentMethodFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SupplierPaymentMethodPreference | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(configuration?.preference);

  return snapshot?.paymentMethod ?? null;
}

export function resolveSuggestedRetentionsFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SupplierRetentionPreference[] | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(configuration?.preference);

  if (!snapshot) {
    return null;
  }

  return snapshot.retentions;
}

export function resolveSuggestedCostCenterFromPreference(
  configuration: Pick<SupplierConfiguration, 'preference'> | null | undefined,
): SupplierCostCenterPreference | null {
  const snapshot = normalizeSupplierPreferenceSnapshot(configuration?.preference);

  return snapshot?.costCenter ?? null;
}
