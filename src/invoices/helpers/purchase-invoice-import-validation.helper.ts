import { DianSalesInvoiceRow } from './sales-invoice-excel.helper';

const MIN_NIT_DIGITS = 5;
const MAX_NIT_DIGITS = 15;

export interface PurchaseInvoiceValidationRowError {
  rowIndex: number;
  cufe: string;
  issuerNit: string;
  issuerName: string;
  reason: string;
}

export interface PurchaseInvoiceValidationReport {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: PurchaseInvoiceValidationRowError[];
}

/**
 * Pasada de validación rápida (sin tocar NextPyme/SIIGO) sobre las filas ya
 * parseadas del Excel: campos faltantes, CUFEs duplicados dentro del mismo
 * archivo, formato de NIT. Se corre ANTES de crear el job de importación,
 * para devolverle al usuario un reporte de errores que pueda revisar y
 * confirmar (o corregir el Excel) antes de disparar ninguna llamada real.
 */
export function validatePurchaseInvoiceExcelRows(
  rows: DianSalesInvoiceRow[],
): PurchaseInvoiceValidationReport {
  const errors: PurchaseInvoiceValidationRowError[] = [];
  const firstRowIndexByCufe = new Map<string, number>();
  const invalidRowIndexes = new Set<number>();

  rows.forEach((row, index) => {
    // 1-based: más intuitivo para el usuario que revisa el reporte.
    const rowIndex = index + 1;
    const cufe = row.cufe?.trim() ?? '';
    const issuerNit = row.issuerNit?.trim() ?? '';
    const issuerName = row.issuerName?.trim() ?? '';

    const addError = (reason: string) => {
      errors.push({ rowIndex, cufe, issuerNit, issuerName, reason });
      invalidRowIndexes.add(rowIndex);
    };

    if (!cufe) {
      addError('Falta el CUFE.');
    } else {
      const firstSeenAt = firstRowIndexByCufe.get(cufe);

      if (firstSeenAt === undefined) {
        firstRowIndexByCufe.set(cufe, rowIndex);
      } else {
        addError(`CUFE duplicado — ya aparece en la fila ${firstSeenAt}.`);
      }
    }

    if (!issuerNit) {
      addError('Falta el NIT del emisor.');
    } else if (
      !/^\d+$/.test(issuerNit) ||
      issuerNit.length < MIN_NIT_DIGITS ||
      issuerNit.length > MAX_NIT_DIGITS
    ) {
      addError(`NIT del emisor con formato inválido (${issuerNit}).`);
    }

    if (!issuerName) {
      addError('Falta el nombre del emisor.');
    }
  });

  return {
    totalRows: rows.length,
    validRows: rows.length - invalidRowIndexes.size,
    invalidRows: invalidRowIndexes.size,
    errors,
  };
}
