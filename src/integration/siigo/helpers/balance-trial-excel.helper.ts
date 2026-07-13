import * as XLSX from 'xlsx';
import { InvalidExcelFormatException } from '../../../common/exceptions/excel.exceptions';

export interface BalanceTrialExcelRow {
  accountCode: string;
  accountName: string;
  identification: string;
  supplierName: string;
}

const COLUMN_ALIASES = {
  accountCode: ['codigo cuenta contable', 'código cuenta contable'],
  accountName: ['nombre cuenta contable'],
  identification: ['identificacion', 'identificación'],
  supplierName: ['nombre tercero'],
} as const;

type BalanceTrialColumnKey = keyof typeof COLUMN_ALIASES;

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
      'No se encontraron las columnas requeridas del Balance de Prueba por Terceros (Código cuenta contable, Nombre Cuenta contable, Identificación, Nombre tercero).',
    );
  }

  const columnIndexes = mapColumnIndexes(matrix[headerRowIndex] ?? []);

  if (!columnIndexes) {
    throw new InvalidExcelFormatException(
      'No se encontraron las columnas requeridas del Balance de Prueba por Terceros (Código cuenta contable, Nombre Cuenta contable, Identificación, Nombre tercero).',
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
): Record<BalanceTrialColumnKey, number> | null {
  const normalizedHeaders = headerRow.map((cell) => normalizeHeader(cell));
  const indexes = {} as Record<BalanceTrialColumnKey, number>;

  for (const [columnKey, aliases] of Object.entries(COLUMN_ALIASES) as Array<
    [BalanceTrialColumnKey, readonly string[]]
  >) {
    const columnIndex = normalizedHeaders.findIndex((header) =>
      aliases.includes(header),
    );

    if (columnIndex === -1) {
      return null;
    }

    indexes[columnKey] = columnIndex;
  }

  return indexes;
}

function mapBalanceTrialRow(
  row: Array<string | number>,
  columnIndexes: Record<BalanceTrialColumnKey, number>,
): BalanceTrialExcelRow | null {
  const accountCode = getCellValue(row, columnIndexes.accountCode);
  const accountName = getCellValue(row, columnIndexes.accountName);
  const identification = getCellValue(row, columnIndexes.identification);
  const supplierName = getCellValue(row, columnIndexes.supplierName);

  if (!accountCode && !identification && !supplierName) {
    return null;
  }

  if (!accountCode || !identification) {
    return null;
  }

  return {
    accountCode,
    accountName: accountName || accountCode,
    identification,
    supplierName: supplierName || `Proveedor ${identification}`,
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

export function limitBalanceTrialRows(
  rows: BalanceTrialExcelRow[],
  maxSuppliers: number,
): {
  rows: BalanceTrialExcelRow[];
  skippedRows: number;
} {
  const allowedSuppliers = new Set<string>();
  const limitedRows: BalanceTrialExcelRow[] = [];
  let skippedRows = 0;

  for (const row of rows) {
    const supplierDocument = row.identification.replace(/[^\d]/g, '');

    if (!supplierDocument) {
      continue;
    }

    if (!allowedSuppliers.has(supplierDocument)) {
      if (allowedSuppliers.size >= maxSuppliers) {
        skippedRows += 1;
        continue;
      }

      allowedSuppliers.add(supplierDocument);
    }

    limitedRows.push(row);
  }

  return {
    rows: limitedRows,
    skippedRows,
  };
}
