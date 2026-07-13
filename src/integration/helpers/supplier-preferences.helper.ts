import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import {
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../interfaces/supplier-mapping-value.interface';
import {
  buildSupplierConfigurationKey,
  resolveSuggestedAccountFromConfiguration,
  SuggestedAccount,
} from './supplier-accounts-catalog.helper';
import { normalizeSupplierMappingValue } from './supplier-mapping-value.helper';

export interface SupplierDocumentIdentity {
  companyId: string;
  documentNumberThird: string | null;
  payload: {
    supplier: {
      documentNumber?: string;
      documentType?: string;
    };
  };
}

export function resolveSupplierConfigurationForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierConfiguration | null {
  const supplierDocument = (
    document.documentNumberThird ??
    document.payload.supplier.documentNumber ??
    ''
  ).replace(/[^\d]/g, '');
  const supplierDocumentType =
    document.payload.supplier.documentType?.trim() || 'NIT';

  if (!supplierDocument) {
    return null;
  }

  return (
    configurationIndex.get(
      buildSupplierConfigurationKey(
        document.companyId,
        integrationId,
        supplierDocumentType,
        supplierDocument,
      ),
    ) ?? null
  );
}

export function resolveSuggestedAccountForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SuggestedAccount | null {
  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  if (!configuration?.autoApply) {
    return null;
  }

  return resolveSuggestedAccountFromConfiguration(configuration);
}

export function resolveSuggestedPaymentMethodForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierPaymentMethodPreference | null {
  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  if (!configuration?.autoApply) {
    return null;
  }

  const mappingValue = normalizeSupplierMappingValue(configuration.mappingValue);

  return mappingValue.paymentMethod ?? null;
}

export function resolveSuggestedRetentionsForDocument(
  document: SupplierDocumentIdentity,
  configurationIndex: Map<string, SupplierConfiguration>,
  integrationId: string,
): SupplierRetentionPreference[] {
  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  if (!configuration?.autoApply) {
    return [];
  }

  const mappingValue = normalizeSupplierMappingValue(configuration.mappingValue);

  return mappingValue.retentions ?? [];
}
