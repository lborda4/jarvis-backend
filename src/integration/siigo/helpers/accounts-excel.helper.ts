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
  groupingLevel: [
    'nivel agrupacion',
    'nivel agrupación',
    'nivel de agrupacion',
    'nivel de agrupación',
  ],
} as const;

type AccountsColumnKey = keyof typeof COLUMN_ALIASES;

type AccountsColumnIndexes = Record<AccountsColumnKey, number>;

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // El Excel real de SIIGO (a diferencia de los datos de prueba) puede
    // traer encabezados con un espacio NBSP entre palabras, o un salto de
    // línea si la celda quedó con ajuste de texto ("Maneja\nvencimientos")
    // — sin este colapso, esas variantes no calzaban con ningún alias de
    // COLUMN_ALIASES y el import fallaba con "columnas requeridas no
    // encontradas" aunque el encabezado fuera, a simple vista, el correcto
    // (bug real reportado). \s ya cubre NBSP y saltos de línea en JS.
    .replace(/\s+/g, ' ')
    .trim();
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

const CELL_ADDRESS_PATTERN = /^([A-Z]+)(\d+)$/;

/** Recalcula `sheet['!ref']` a partir de las claves de celda que realmente
 * existen en la hoja — ver el comentario en parseAccountsExcel sobre por
 * qué el "!ref" que trae el archivo de SIIGO no alcanza a cubrir todas las
 * columnas. No hace nada si no encuentra ninguna celda con formato de
 * dirección (hoja vacía). Exportada para poder testearla directo sobre un
 * WorkSheet en memoria — simular el archivo corrupto real requiere manipular
 * "!ref" después de leerlo, y XLSX.write recalcula el rango real al
 * reescribir el buffer, así que no hay forma de reproducir el bug pasando
 * por parseAccountsExcel(buffer) de punta a punta. */
export function fixWorksheetRange(sheet: XLSX.WorkSheet): void {
  let maxRow = -1;
  let maxCol = -1;

  for (const key of Object.keys(sheet)) {
    const match = CELL_ADDRESS_PATTERN.exec(key);

    if (!match) {
      continue;
    }

    const cell = XLSX.utils.decode_cell(key);
    maxRow = Math.max(maxRow, cell.r);
    maxCol = Math.max(maxCol, cell.c);
  }

  if (maxRow === -1 || maxCol === -1) {
    return;
  }

  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow, c: maxCol },
  });
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
    // codepage 65001 (UTF-8): el archivo real de SIIGO es texto plano
    // separado por tabs con extensión .xlsx/.xls (no un binario OOXML/BIFF
    // real) — SheetJS lo detecta como CSV/texto y, SIN este codepage
    // explícito, lo decodifica como Latin-1 por defecto: "Código" queda
    // "CÃ³digo", "Nivel agrupación" queda "Nivel agrupaciÃ³n", etc. Esas dos
    // columnas (las únicas con tilde entre las requeridas) dejaban de
    // calzar con ningún alias y el archivo se rechazaba con "columnas
    // requeridas no encontradas" aunque el encabezado se viera perfecto al
    // pegarlo como texto (bug real reportado — un archivo .xlsx real, sin
    // texto plano de por medio, no se ve afectado por este codepage).
    workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  } catch {
    throw new InvalidExcelFormatException(
      'No se pudo leer el archivo Excel proporcionado.',
    );
  }

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new InvalidExcelFormatException('El archivo Excel no contiene hojas.');
  }

  const sheet = workbook.Sheets[sheetName];

  // El export real de SIIGO trae las celdas de todas las columnas (B, C,
  // D...) pero declara mal su propio "!ref" (ej. "A1:A1091", como si solo
  // existiera la columna A) — sheet_to_json confía en ese rango declarado
  // y descarta todo lo que quede afuera, así que ninguna columna aparte de
  // "Código" llegaba a mapColumnIndexes (bug real reportado: el encabezado
  // se veía perfecto al pegarlo como texto, pero el import igual fallaba
  // con "columnas requeridas no encontradas"). Se recalcula acá el rango
  // real a partir de las celdas que de verdad existen, en vez de confiar en
  // el que trae el archivo.
  fixWorksheetRange(sheet);

  const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });

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
