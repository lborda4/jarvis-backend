import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SiigoAccount } from '../entities/siigo-account.entity';
import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';
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

export function isLeafAccountCode(
  code: string,
  allCodes: readonly string[],
): boolean {
  const normalizedCode = code.trim();

  if (!normalizedCode) {
    return false;
  }

  return !allCodes.some(
    (otherCode) =>
      otherCode !== normalizedCode && otherCode.startsWith(normalizedCode),
  );
}

export function shouldIncludeAccountInCatalog(
  account: Pick<SiigoAccount, 'code' | 'isTransactional'>,
  allCodes: readonly string[],
): boolean {
  const code = account.code.trim();

  if (!code || !isAllowedAccountCode(code)) {
    return false;
  }

  if (account.isTransactional === true) {
    return true;
  }

  return isLeafAccountCode(code, allCodes);
}

export function collectUniqueAccountsCatalog(
  accounts: Array<Pick<SiigoAccount, 'code' | 'name' | 'isTransactional'>>,
): AccountCatalogItem[] {
  const accountsByCode = new Map<string, AccountCatalogItem>();
  const allCodes = accounts
    .map((account) => account.code.trim())
    .filter(Boolean);

  for (const account of accounts) {
    const code = account.code.trim();
    const name = account.name.trim() || code;

    if (
      !code ||
      accountsByCode.has(code) ||
      !shouldIncludeAccountInCatalog(account, allCodes)
    ) {
      continue;
    }

    accountsByCode.set(code, { code, name });
  }

  return [...accountsByCode.values()].sort((left, right) =>
    left.code.localeCompare(right.code),
  );
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
