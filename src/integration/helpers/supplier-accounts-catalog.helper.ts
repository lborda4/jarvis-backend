import { SupplierConfiguration } from '../entities/supplier-configuration.entity';
import { SiigoAccount } from '../entities/siigo-account.entity';
import { normalizeSupplierDocument } from '../siigo/helpers/siigo-context.helper';
export {
  resolveSuggestedAccountForDocument,
  resolveSuggestedPaymentMethodForDocument,
  resolveSuggestedRetentionsForDocument,
} from './supplier-preferences.helper';

/**
 * Mapa code → name del catálogo REAL de cuentas SIIGO de una empresa
 * (`siigo_accounts`) — la única fuente de verdad para el nombre de una
 * cuenta. Cualquier sugerencia de cuenta (del historial de compras, de una
 * regla item-level, de una preferencia guardada) solo conoce el código; el
 * nombre SIEMPRE debe resolverse contra este catálogo antes de mostrarse,
 * nunca asumirse ni usar el código como si fuera el nombre.
 */
export function buildAccountNameByCode(
  accounts: Array<Pick<SiigoAccount, 'code' | 'name'>>,
): Map<string, string> {
  const byCode = new Map<string, string>();

  for (const account of accounts) {
    const code = account.code?.trim();
    const name = account.name?.trim();

    if (code && name) {
      byCode.set(code, name);
    }
  }

  return byCode;
}

/**
 * Resuelve el nombre real de una cuenta contra el catálogo — si el código
 * no está en el catálogo (proveedor nuevo, cuenta borrada en SIIGO desde
 * entonces, etc.) cae a `fallbackName`, pero el catálogo SIEMPRE gana
 * cuando tiene el código. Esto es lo que evita que una sugerencia
 * "aprendida" del historial (que solo guarda el código, nunca un nombre
 * confiable) termine mostrando el código repetido como si fuera el nombre
 * de la cuenta — bug real reportado en producción (ver
 * supplier-accounts-catalog.helper.spec.ts).
 */
export function resolveAccountNameFromCatalog(
  code: string,
  fallbackName: string | null,
  accountNameByCode: Map<string, string>,
): string | null {
  return accountNameByCode.get(code.trim()) ?? fallbackName;
}

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
