import * as XLSX from 'xlsx';
import { InvalidExcelFormatException } from '../../../common/exceptions/excel.exceptions';

export interface BalanceTrialExcelRow {
  accountCode: string;
  accountName: string;
  isTransactional: boolean;
}

const REQUIRED_COLUMN_ALIASES = {
  accountCode: ['codigo cuenta contable', 'código cuenta contable'],
  accountName: ['nombre cuenta contable'],
} as const;

const OPTIONAL_COLUMN_ALIASES = {
  transactional: ['transaccional'],
} as const;

type RequiredBalanceTrialColumnKey = keyof typeof REQUIRED_COLUMN_ALIASES;
type OptionalBalanceTrialColumnKey = keyof typeof OPTIONAL_COLUMN_ALIASES;

interface BalanceTrialColumnIndexes {
  accountCode: number;
  accountName: number;
  transactional?: number;
}

const TRANSACTIONAL_TRUE_VALUES = new Set([
  'si',
  's',
  'yes',
  'y',
  'true',
  'verdadero',
  '1',
  'x',
]);
const TRANSACTIONAL_FALSE_VALUES = new Set(['no', 'n', 'false', 'falso', '0']);

export function parseTransactionalFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) {
    return false;
  }

  if (TRANSACTIONAL_TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (TRANSACTIONAL_FALSE_VALUES.has(normalized)) {
    return false;
  }

  return false;
}

export function parseBalanceTrialExcel(buffer: Buffer): BalanceTrialExcelRow[] {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new InvalidExcelFormatException(
      'No se pudo leer el archivo Excel proporcionado.',
    );
  }

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new InvalidExcelFormatException('El archivo Excel no contiene hojas.');
  }

  const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
  });

  const headerRowIndex = findHeaderRowIndex(matrix);

  if (headerRowIndex === -1) {
    throw new InvalidExcelFormatException(
      'No se encontraron las columnas requeridas del Balance de Prueba (Código cuenta contable, Nombre Cuenta contable).',
    );
  }

  const columnIndexes = mapColumnIndexes(matrix[headerRowIndex] ?? []);

  if (!columnIndexes) {
    throw new InvalidExcelFormatException(
      'No se encontraron las columnas requeridas del Balance de Prueba (Código cuenta contable, Nombre Cuenta contable).',
    );
  }

  const rows: BalanceTrialExcelRow[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex] ?? [];
    const parsedRow = mapBalanceTrialRow(row, columnIndexes);

    if (parsedRow) {
      rows.push(parsedRow);
    }
  }

  if (rows.length === 0) {
    throw new InvalidExcelFormatException(
      'El archivo no contiene filas válidas para importar después del encabezado.',
    );
  }

  return rows;
}

function findHeaderRowIndex(matrix: Array<Array<string | number>>): number {
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    const columnIndexes = mapColumnIndexes(matrix[rowIndex] ?? []);

    if (columnIndexes) {
      return rowIndex;
    }
  }

  return -1;
}

function mapColumnIndexes(
  headerRow: Array<string | number>,
): BalanceTrialColumnIndexes | null {
  const normalizedHeaders = headerRow.map((cell) => normalizeHeader(cell));
  const indexes = {} as BalanceTrialColumnIndexes;

  for (const [columnKey, aliases] of Object.entries(REQUIRED_COLUMN_ALIASES) as Array<
    [RequiredBalanceTrialColumnKey, readonly string[]]
  >) {
    const columnIndex = normalizedHeaders.findIndex((header) =>
      aliases.includes(header),
    );

    if (columnIndex === -1) {
      return null;
    }

    indexes[columnKey] = columnIndex;
  }

  for (const [columnKey, aliases] of Object.entries(OPTIONAL_COLUMN_ALIASES) as Array<
    [OptionalBalanceTrialColumnKey, readonly string[]]
  >) {
    const columnIndex = normalizedHeaders.findIndex((header) =>
      aliases.includes(header),
    );

    if (columnIndex !== -1) {
      indexes[columnKey] = columnIndex;
    }
  }

  return indexes;
}

function mapBalanceTrialRow(
  row: Array<string | number>,
  columnIndexes: BalanceTrialColumnIndexes,
): BalanceTrialExcelRow | null {
  const accountCode = getCellValue(row, columnIndexes.accountCode);
  const accountName = getCellValue(row, columnIndexes.accountName);

  if (!accountCode) {
    return null;
  }

  const transactionalValue =
    columnIndexes.transactional === undefined
      ? undefined
      : getCellValue(row, columnIndexes.transactional);

  return {
    accountCode,
    accountName: accountName || accountCode,
    isTransactional: parseTransactionalFlag(transactionalValue),
  };
}

function getCellValue(
  row: Array<string | number>,
  columnIndex: number,
): string {
  const value = row[columnIndex];

  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function normalizeHeader(value: string | number): string {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function dedupeBalanceTrialRows(
  rows: BalanceTrialExcelRow[],
): BalanceTrialExcelRow[] {
  const accountsByCode = new Map<string, BalanceTrialExcelRow>();

  for (const row of rows) {
    const code = row.accountCode.trim();

    if (!code) {
      continue;
    }

    const normalizedRow: BalanceTrialExcelRow = {
      accountCode: code,
      accountName: row.accountName.trim() || code,
      isTransactional: row.isTransactional,
    };

    const existingRow = accountsByCode.get(code);

    if (
      !existingRow ||
      (!existingRow.isTransactional && normalizedRow.isTransactional)
    ) {
      accountsByCode.set(code, normalizedRow);
    }
  }

  return [...accountsByCode.values()];
}
