import { CreateSiigoSupportDocumentRequestDto } from '../dto/create-siigo-support-document.dto';
import { SiigoTaxCatalogItemDto } from '../dto/list-siigo-taxes.dto';
import {
  normalizeSupplierPaymentMethodPreference,
  normalizeSupplierRetentionPreferences,
} from '../../helpers/supplier-mapping-value.helper';
import { SupplierPreferenceSnapshot } from '../../interfaces/supplier-preference.interface';

export function buildSupplierPreferenceSnapshotFromSendRequest(
  request: CreateSiigoSupportDocumentRequestDto,
  taxesCatalog: SiigoTaxCatalogItemDto[],
): SupplierPreferenceSnapshot | null {
  const accountCode = request.items[0]?.code?.trim();

  if (!accountCode) {
    return null;
  }

  const taxesById = new Map(taxesCatalog.map((tax) => [tax.id, tax]));
  const snapshot = request.supplierPreferences;
  const paymentMethod = snapshot?.paymentMethod ?? {
    id: request.payments[0]?.id,
    name: '',
    type: '',
  };

  if (!paymentMethod?.id) {
    return null;
  }

  const retentions =
    snapshot?.retentions ??
    (request.retentions ?? []).map((retention) => {
      const tax = taxesById.get(retention.id);

      return {
        id: retention.id,
        name: tax?.name ?? `Retención ${retention.id}`,
        type: retention.type ?? tax?.type ?? '',
        percentage: tax?.percentage ?? 0,
      };
    });

  const normalizedPaymentMethod = normalizeSupplierPaymentMethodPreference({
    id: paymentMethod.id,
    name: paymentMethod.name?.trim() || `Medio ${paymentMethod.id}`,
    type: paymentMethod.type?.trim() || '',
    ...(paymentMethod.dueDate === undefined
      ? {}
      : { dueDate: paymentMethod.dueDate }),
  });

  if (!normalizedPaymentMethod) {
    return null;
  }

  return {
    account: {
      code: accountCode,
      name:
        snapshot?.accountDescription?.trim() ||
        request.items[0]?.description?.trim() ||
        accountCode,
    },
    paymentMethod: normalizedPaymentMethod,
    retentions: normalizeSupplierRetentionPreferences(retentions),
  };
}
