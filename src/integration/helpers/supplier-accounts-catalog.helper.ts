import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';
import {
  getMostUsedSupplierAccount,
  normalizeSupplierMappingValue,
} from './supplier-mapping-value.helper';
export {
  resolveSuggestedAccountForDocument,
  resolveSuggestedPaymentMethodForDocument,
  resolveSuggestedRetentionsForDocument,
} from './supplier-preferences.helper';

export function buildSupplierNameLookup(
  configurations: Array<
    Pick<SupplierConfiguration, 'supplierDocument' | 'supplierName'>
  >,
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const configuration of configurations) {
    const nit = normalizeSupplierDocument(configuration.supplierDocument);
    const name = configuration.supplierName?.trim();

    if (!nit || !name || lookup.has(nit)) {
      continue;
    }

    lookup.set(nit, name);
  }

  return lookup;
}

export interface AccountCatalogItem {
  code: string;
  name: string;
}

export interface SuggestedAccount {
  code: string;
  name: string;
  uses: number;
}

const ALLOWED_ACCOUNT_CLASSES = ['5', '6', '7'] as const;

export function isAllowedAccountCode(code: string): boolean {
  const normalizedCode = code.trim();

  return ALLOWED_ACCOUNT_CLASSES.some((accountClass) =>
    normalizedCode.startsWith(accountClass),
  );
}

export function collectUniqueAccountsCatalog(
  configurations: Array<Pick<SupplierConfiguration, 'mappingValue'>>,
): AccountCatalogItem[] {
  const accountsByCode = new Map<string, AccountCatalogItem>();

  for (const configuration of configurations) {
    const mappingValue = normalizeSupplierMappingValue(
      configuration.mappingValue,
    );

    for (const account of mappingValue.accounts) {
      const code = account.code.trim();
      const name = account.name.trim() || code;

      if (!code || accountsByCode.has(code) || !isAllowedAccountCode(code)) {
        continue;
      }

      accountsByCode.set(code, { code, name });
    }
  }

  return [...accountsByCode.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
}

export function resolveSuggestedAccountFromConfiguration(
  configuration: Pick<SupplierConfiguration, 'mappingValue'> | null | undefined,
): SuggestedAccount | null {
  const mappingValue = normalizeSupplierMappingValue(configuration?.mappingValue);
  const account = getMostUsedSupplierAccount(mappingValue);

  if (!account || !isAllowedAccountCode(account.code)) {
    return null;
  }

  return {
    code: account.code,
    name: account.name,
    uses: account.uses,
  };
}

export function buildSupplierConfigurationKey(
  companyId: string,
  integrationId: string,
  supplierDocumentType: string,
  supplierDocument: string,
): string {
  return [
    companyId,
    integrationId,
    supplierDocumentType.trim() || 'NIT',
    normalizeSupplierDocument(supplierDocument),
  ].join('|');
}

export function indexSupplierConfigurations(
  configurations: SupplierConfiguration[],
): Map<string, SupplierConfiguration> {
  const indexed = new Map<string, SupplierConfiguration>();

  for (const configuration of configurations) {
    const normalizedDocument = normalizeSupplierDocument(
      configuration.supplierDocument,
    );

    if (!normalizedDocument) {
      continue;
    }

    indexed.set(
      buildSupplierConfigurationKey(
        configuration.companyId,
        configuration.integrationId,
        configuration.supplierDocumentType,
        normalizedDocument,
      ),
      configuration,
    );
  }

  return indexed;
}
