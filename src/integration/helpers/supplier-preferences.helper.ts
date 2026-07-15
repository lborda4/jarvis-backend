import { ElectronicDocumentStatus } from '../../electronic-document/enums/electronic-document-status.enum';
import { resolveSendConfigurationFromPayload } from '../../electronic-document/helpers/electronic-document-send-configuration.helper';
import { ElectronicDocumentPayload } from '../../electronic-document/interfaces/electronic-document-payload.interface';
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
import {
  resolveSuggestedAccountFromPreference,
  resolveSuggestedPaymentMethodFromPreference,
  resolveSuggestedRetentionsFromPreference,
} from './supplier-preference.helper';

export interface SupplierDocumentIdentity {
  companyId: string;
  status?: string;
  documentNumberThird: string | null;
  payload: Pick<ElectronicDocumentPayload, 'supplier' | 'siigoSendConfiguration'>;
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
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    const sendConfiguration = resolveSendConfigurationFromPayload(document.payload);

    if (sendConfiguration) {
      return {
        code: sendConfiguration.account.code,
        name: sendConfiguration.account.name,
        uses: 1,
      };
    }

    return null;
  }

  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  const preferenceAccount = resolveSuggestedAccountFromPreference(configuration);

  if (preferenceAccount) {
    return preferenceAccount;
  }

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
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    return resolveSendConfigurationFromPayload(document.payload)?.paymentMethod ?? null;
  }

  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  const preferencePaymentMethod =
    resolveSuggestedPaymentMethodFromPreference(configuration);

  if (preferencePaymentMethod) {
    return preferencePaymentMethod;
  }

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
  if (document.status === ElectronicDocumentStatus.PURCHASE_CREATED) {
    return resolveSendConfigurationFromPayload(document.payload)?.retentions ?? [];
  }

  const configuration = resolveSupplierConfigurationForDocument(
    document,
    configurationIndex,
    integrationId,
  );

  const preferenceRetentions =
    resolveSuggestedRetentionsFromPreference(configuration);

  if (preferenceRetentions !== null) {
    return preferenceRetentions;
  }

  if (!configuration?.autoApply) {
    return [];
  }

  const mappingValue = normalizeSupplierMappingValue(configuration.mappingValue);

  return mappingValue.retentions ?? [];
}
