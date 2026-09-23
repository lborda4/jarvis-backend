import * as XLSX from 'xlsx';
import { InvalidExcelFormatException } from '../../../common/exceptions/excel.exceptions';
import { isAllowedAccountCode } from '../../helpers/supplier-accounts-catalog.helper';
import { normalizeSupplierDocument } from './siigo-context.helper';

export interface ThirdPartyBalanceExcelRow {
  supplierDocument: string;
  accountCode: string;
}

const ACCOUNT_COLUMN_ALIASES = [
  'codigo cuenta contable',
  'codigo de cuenta contable',
  'codigo contable',
  'cuenta contable',
  'cuenta',
] as const;

const SUPPLIER_COLUMN_ALIASES = [
  'identificacion tercero',
  'identificacion del tercero',
  'numero identificacion tercero',
  'numero de identificacion tercero',
  'documento tercero',
  'documento del tercero',
  'nit tercero',
  'nit del tercero',
  'identificacion',
  'nit',
] as const;

interface ThirdPartyBalanceColumnIndexes {
  accountCode: number;
  supplierDocument: number;
}

export function parseThirdPartyBalanceExcel(
  buffer: Buffer,
): ThirdPartyBalanceExcelRow[] {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new InvalidExcelFormatException(
      'No se pudo leer el balance de prueba por tercero descargado de SIIGO.',
    );
  }

  const parsedRows: ThirdPartyBalanceExcelRow[] = [];
  let foundHeader = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      continue;
    }

    const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    const header = findHeader(matrix);

    if (!header) {
      continue;
    }

    foundHeader = true;
    let currentAccountCode = '';

    for (
      let rowIndex = header.rowIndex + 1;
      rowIndex < matrix.length;
      rowIndex++
    ) {
      const row = matrix[rowIndex] ?? [];
      const accountCode = normalizeAccountCode(
        getCellValue(row, header.indexes.accountCode),
      );

      if (accountCode) {
        currentAccountCode = accountCode;
      }

      const supplierDocument = normalizeSupplierDocument(
        getCellValue(row, header.indexes.supplierDocument),
      );
      const effectiveAccountCode = accountCode || currentAccountCode;

      if (
        !supplierDocument ||
        !effectiveAccountCode ||
        !isAllowedAccountCode(effectiveAccountCode)
      ) {
        continue;
      }

      parsedRows.push({
        supplierDocument,
        accountCode: effectiveAccountCode,
      });
    }
  }

  if (!foundHeader) {
    throw new InvalidExcelFormatException(
      'No se encontraron las columnas de identificación del tercero y cuenta contable en el balance descargado de SIIGO.',
    );
  }

  return dedupeThirdPartyBalanceRows(parsedRows);
}

function findHeader(
  matrix: Array<Array<string | number>>,
): { rowIndex: number; indexes: ThirdPartyBalanceColumnIndexes } | null {
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    const headers = (matrix[rowIndex] ?? []).map(normalizeHeader);
    const accountCode = findAliasIndex(headers, ACCOUNT_COLUMN_ALIASES);
    const supplierDocument = findAliasIndex(headers, SUPPLIER_COLUMN_ALIASES);

    if (accountCode !== -1 && supplierDocument !== -1) {
      return { rowIndex, indexes: { accountCode, supplierDocument } };
    }
  }

  return null;
}

function findAliasIndex(headers: string[], aliases: readonly string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function normalizeAccountCode(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function getCellValue(
  row: Array<string | number>,
  columnIndex: number,
): string {
  const value = row[columnIndex];
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeHeader(value: string | number): string {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function dedupeThirdPartyBalanceRows(
  rows: ThirdPartyBalanceExcelRow[],
): ThirdPartyBalanceExcelRow[] {
  const uniqueRows = new Map<string, ThirdPartyBalanceExcelRow>();

  for (const row of rows) {
    const supplierDocument = normalizeSupplierDocument(row.supplierDocument);
    const accountCode = normalizeAccountCode(row.accountCode);

    if (
      !supplierDocument ||
      !accountCode ||
      !isAllowedAccountCode(accountCode)
    ) {
      continue;
    }

    uniqueRows.set(`${supplierDocument}::${accountCode}`, {
      supplierDocument,
      accountCode,
    });
  }

  return [...uniqueRows.values()];
}
