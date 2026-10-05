import {
  SiigoCreditNoteNumbering,
  SiigoCredentials,
} from '../../interfaces/integration-credentials.interface';

export const SIIGO_CREDIT_NOTE_DEFAULT_PREFIX = 'NC';
export const SIIGO_CREDIT_NOTE_DEFAULT_TO_NUMBER = 9_999_999;

export function createDefaultSiigoCreditNoteNumbering(
  prefix = SIIGO_CREDIT_NOTE_DEFAULT_PREFIX,
): SiigoCreditNoteNumbering {
  return {
    prefix: prefix.trim() || SIIGO_CREDIT_NOTE_DEFAULT_PREFIX,
    fromNumber: 1,
    toNumber: SIIGO_CREDIT_NOTE_DEFAULT_TO_NUMBER,
    nextConsecutive: 1,
  };
}

export function normalizeSiigoCreditNoteNumbering(
  raw: unknown,
): SiigoCreditNoteNumbering | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const prefix = String(value.prefix ?? '').trim();
  const fromNumber = Number(value.fromNumber ?? value.from_number ?? 1);
  const toNumber = Number(
    value.toNumber ?? value.to_number ?? SIIGO_CREDIT_NOTE_DEFAULT_TO_NUMBER,
  );
  const nextConsecutive = Number(
    value.nextConsecutive ?? value.next_consecutive ?? fromNumber,
  );

  if (!prefix || !Number.isSafeInteger(fromNumber) || fromNumber < 1) {
    return undefined;
  }

  if (!Number.isSafeInteger(toNumber) || toNumber < fromNumber) {
    return undefined;
  }

  if (!Number.isSafeInteger(nextConsecutive) || nextConsecutive < 1) {
    return undefined;
  }

  return {
    prefix,
    fromNumber,
    toNumber,
    nextConsecutive,
  };
}

export function ensureSiigoCreditNoteNumbering(
  credentials: SiigoCredentials,
): SiigoCreditNoteNumbering {
  return (
    normalizeSiigoCreditNoteNumbering(credentials.credit_note) ??
    createDefaultSiigoCreditNoteNumbering()
  );
}

export function getSiigoCreditNoteNextNumber(
  numbering: SiigoCreditNoteNumbering,
): number | null {
  if (
    numbering.nextConsecutive < numbering.fromNumber ||
    numbering.nextConsecutive > numbering.toNumber
  ) {
    return null;
  }

  return numbering.nextConsecutive;
}
