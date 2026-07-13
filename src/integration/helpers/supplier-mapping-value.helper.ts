import {
  SupplierAccountMapping,
  SupplierMappingValue,
  SupplierPaymentMethodPreference,
  SupplierRetentionPreference,
} from '../interfaces/supplier-mapping-value.interface';

export function createEmptySupplierMappingValue(): SupplierMappingValue {
  return { accounts: [] };
}

export function createSupplierMappingValue(
  code: string,
  name?: string,
): SupplierMappingValue {
  const trimmedCode = code.trim();
  const trimmedName = (name ?? code).trim() || trimmedCode;

  return {
    accounts: [{ code: trimmedCode, name: trimmedName, uses: 1 }],
  };
}

export function normalizeSupplierMappingValue(
  value: unknown,
): SupplierMappingValue {
  const candidate = value as Partial<SupplierMappingValue>;

  if (!candidate?.accounts || !Array.isArray(candidate.accounts)) {
    return createEmptySupplierMappingValue();
  }

  const accountsByCode = new Map<string, SupplierAccountMapping>();

  for (const account of candidate.accounts) {
    const normalizedAccount = normalizeAccountMapping(account);

    if (!normalizedAccount) {
      continue;
    }

    const existingAccount = accountsByCode.get(normalizedAccount.code);

    if (!existingAccount) {
      accountsByCode.set(normalizedAccount.code, normalizedAccount);
      continue;
    }

    accountsByCode.set(normalizedAccount.code, {
      code: normalizedAccount.code,
      name: normalizedAccount.name,
      uses: existingAccount.uses + normalizedAccount.uses,
    });
  }

  return {
    accounts: [...accountsByCode.values()],
    ...(candidate.paymentMethod !== undefined
      ? {
          paymentMethod: normalizeSupplierPaymentMethodPreference(
            candidate.paymentMethod,
          ),
        }
      : {}),
    ...(candidate.retentions !== undefined
      ? { retentions: normalizeSupplierRetentionPreferences(candidate.retentions) }
      : {}),
  };
}

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

export function applySupplierPreferencesToMappingValue(
  mappingValue: SupplierMappingValue | null | undefined,
  preferences: {
    account?: Pick<SupplierAccountMapping, 'code' | 'name'> | null;
    paymentMethod?: SupplierPaymentMethodPreference | null;
    retentions?: SupplierRetentionPreference[] | null;
  },
): SupplierMappingValue {
  let nextValue = mappingValue ?? createEmptySupplierMappingValue();

  if (preferences.account?.code?.trim()) {
    const accountResult = addAccountToSupplierMapping(nextValue, {
      code: preferences.account.code,
      name: preferences.account.name,
    });
    nextValue = accountResult.mappingValue;
  }

  if (preferences.paymentMethod) {
    nextValue = {
      ...nextValue,
      paymentMethod: preferences.paymentMethod,
    };
  }

  if (preferences.retentions !== undefined) {
    nextValue = {
      ...nextValue,
      retentions: preferences.retentions ?? [],
    };
  }

  return nextValue;
}

export function getSupplierAccountsSortedByUses(
  mappingValue: SupplierMappingValue | null | undefined,
): SupplierAccountMapping[] {
  if (!mappingValue?.accounts?.length) {
    return [];
  }

  return [...mappingValue.accounts].sort((leftAccount, rightAccount) => {
    const usesDiff = rightAccount.uses - leftAccount.uses;

    if (usesDiff !== 0) {
      return usesDiff;
    }

    return leftAccount.code.localeCompare(rightAccount.code);
  });
}

export function getPrimarySupplierAccountCode(
  mappingValue: SupplierMappingValue | null | undefined,
): string | null {
  const account = getMostUsedSupplierAccount(mappingValue);

  return account?.code?.trim() || null;
}

export function getMostUsedSupplierAccount(
  mappingValue: SupplierMappingValue | null | undefined,
): SupplierAccountMapping | null {
  return getSupplierAccountsSortedByUses(mappingValue)[0] ?? null;
}

export function addAccountToSupplierMapping(
  mappingValue: SupplierMappingValue | null | undefined,
  account: Pick<SupplierAccountMapping, 'code' | 'name'>,
): {
  mappingValue: SupplierMappingValue;
  added: boolean;
  incremented: boolean;
} {
  const current = mappingValue ?? createEmptySupplierMappingValue();
  const code = account.code.trim();
  const name = account.name.trim() || code;

  if (!code) {
    return { mappingValue: current, added: false, incremented: false };
  }

  const existingIndex = current.accounts.findIndex(
    (existingAccount) => existingAccount.code === code,
  );

  if (existingIndex !== -1) {
    const existingAccount = current.accounts[existingIndex];
    const updatedAccounts = [...current.accounts];

    updatedAccounts[existingIndex] = {
      code,
      name,
      uses: existingAccount.uses + 1,
    };

    return {
      mappingValue: {
        ...current,
        accounts: updatedAccounts,
      },
      added: false,
      incremented: true,
    };
  }

  return {
    mappingValue: {
      ...current,
      accounts: [...current.accounts, { code, name, uses: 1 }],
    },
    added: true,
    incremented: false,
  };
}

function normalizeAccountMapping(
  account: unknown,
): SupplierAccountMapping | null {
  if (!account || typeof account !== 'object') {
    return null;
  }

  const candidate = account as Partial<SupplierAccountMapping> & {
    accountCode?: string;
    accountName?: string;
  };
  const code = (candidate.code ?? candidate.accountCode)?.trim();

  if (!code) {
    return null;
  }

  const name =
    (candidate.name ?? candidate.accountName)?.trim() || code;
  const uses = normalizeUses(candidate.uses);

  return {
    code,
    name,
    uses,
  };
}

function normalizeUses(value: unknown): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.floor(parsed);
}
