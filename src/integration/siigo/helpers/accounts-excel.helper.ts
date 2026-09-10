import * as XLSX from 'xlsx';
import { InvalidExcelFormatException } from '../../../common/exceptions/excel.exceptions';

export interface AccountsExcelRow {
  accountCode: string;
  accountName: string;
}

export interface ParseAccountsExcelResult {
  /** Cuentas que pasaron los cuatro filtros y se van a guardar. */
  rows: AccountsExcelRow[];
  /** Filas con datos que se descartaron por no cumplir algún filtro. */
  skippedRows: number;
}

/** Solo se guardan las clases que se usan para contabilizar documentos:
 * 1 Activo, 2 Pasivo, 5 Gastos, 6 Costos de venta y 7 Costos de producción.
 * Quedan fuera 3 (Patrimonio), 4 (Ingresos), 8 y 9 (cuentas de orden). */
const ALLOWED_ACCOUNT_CLASSES = new Set(['1', '2', '5', '6', '7']);

const COLUMN_ALIASES = {
  accountCode: ['codigo', 'código'],
  accountName: ['nombre'],
  dueDates: ['maneja vencimientos', 'maneja vencimiento'],
  active: ['activo'],
  groupingLevel: ['nivel agrupacion', 'nivel agrupación'],
} as const;

type AccountsColumnKey = keyof typeof COLUMN_ALIASES;

type AccountsColumnIndexes = Record<AccountsColumnKey, number>;

function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** El archivo trae un bloque de título antes del encabezado ("Cuentas
 * contables", razón social, NIT), así que la fila de encabezados se busca en
 * vez de asumirse en la primera. */
function mapColumnIndexes(
  headerRow: Array<string | number>,
): AccountsColumnIndexes | null {
  const indexes: Partial<AccountsColumnIndexes> = {};

  headerRow.forEach((cell, columnIndex) => {
    const header = normalize(cell);

    if (!header) {
      return;
    }

    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      const columnKey = key as AccountsColumnKey;

      if (indexes[columnKey] != null) {
        continue;
      }

      if ((aliases as readonly string[]).some((alias) => alias === header)) {
        indexes[columnKey] = columnIndex;
      }
    }
  });

  const isComplete = (
    Object.keys(COLUMN_ALIASES) as AccountsColumnKey[]
  ).every((key) => indexes[key] != null);

  return isComplete ? (indexes as AccountsColumnIndexes) : null;
}

function findHeaderRowIndex(matrix: Array<Array<string | number>>): number {
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    if (mapColumnIndexes(matrix[rowIndex] ?? [])) {
      return rowIndex;
    }
  }

  return -1;
}

function isAffirmative(value: string): boolean {
  const normalized = normalize(value);
  return normalized === 'si' || normalized === 'x' || normalized === 'true';
}

/** "No maneja vencimiento" es el valor que trae el archivo para las cuentas
 * que NO manejan vencimientos; cualquier otro texto ("Maneja vencimiento",
 * "Documento", etc.) significa que sí los maneja. */
function hasNoDueDates(value: string): boolean {
  return normalize(value).startsWith('no maneja');
}

function isTransactional(value: string): boolean {
  return normalize(value) === 'transaccional';
}

/**
 * Lee el Excel de cuentas contables y devuelve SOLO las que se deben guardar:
 * de clase 1, 2, 5, 6 o 7, sin manejo de vencimientos, activas y de nivel
 * transaccional. Las cuentas de agrupación (las que en el archivo vienen sin
 * categoría ni nivel, como "1", "11", "1105") existen para dar la jerarquía
 * del PUC, pero no se pueden usar para contabilizar un documento.
 */
export function parseAccountsExcel(buffer: Buffer): ParseAccountsExcelResult {
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

  const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(
    workbook.Sheets[sheetName],
    { header: 1, defval: '', raw: false },
  );

  const headerRowIndex = findHeaderRowIndex(matrix);
  const columnIndexes =
    headerRowIndex === -1 ? null : mapColumnIndexes(matrix[headerRowIndex]);

  if (!columnIndexes) {
    throw new InvalidExcelFormatException(
      'No se encontraron las columnas requeridas del archivo de cuentas contables (Código, Nombre, Maneja vencimientos, Activo, Nivel agrupación).',
    );
  }

  const rows: AccountsExcelRow[] = [];
  const seenCodes = new Set<string>();
  let skippedRows = 0;

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const row = matrix[rowIndex] ?? [];
    const accountCode = String(row[columnIndexes.accountCode] ?? '').trim();
    const accountName = String(row[columnIndexes.accountName] ?? '').trim();

    if (!accountCode && !accountName) {
      // Fila en blanco: no es un descarte, simplemente no hay nada ahí.
      continue;
    }

    const passesFilters =
      Boolean(accountCode) &&
      Boolean(accountName) &&
      ALLOWED_ACCOUNT_CLASSES.has(accountCode[0]) &&
      hasNoDueDates(String(row[columnIndexes.dueDates] ?? '')) &&
      isAffirmative(String(row[columnIndexes.active] ?? '')) &&
      isTransactional(String(row[columnIndexes.groupingLevel] ?? ''));

    if (!passesFilters || seenCodes.has(accountCode)) {
      skippedRows += 1;
      continue;
    }

    seenCodes.add(accountCode);
    rows.push({ accountCode, accountName });
  }

  return { rows, skippedRows };
}
