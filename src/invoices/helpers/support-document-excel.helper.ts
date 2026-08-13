import * as XLSX from 'xlsx';
import { InvalidExcelFormatException } from '../../common/exceptions/excel.exceptions';
import {
  GroupedSupportDocument,
  SupportDocumentExcelRow,
} from '../../electronic-document/interfaces/support-document-import.interface';
import { normalizeSupportDocumentType } from './support-document-type.helper';
import {
  convertDayMonthYearToIso,
  matchIsoDate,
} from '../../common/helpers/date-normalization.helper';

const REQUIRED_COLUMNS_MESSAGE =
  'Fecha, Tipo de documento, Numero de documento, Prefijo, Consecutivo, Descripcion';

const COLUMN_ALIASES = {
  issueDate: ['fecha', 'fecha emision'],
  supplierDocumentType: [
    'tipo de documento',
    'tipo documento',
    'tipo doc',
    'tipo de doc',
  ],
  supplierIdentification: [
    'numero de documento',
    'numero documento',
    'nro documento',
    'no documento',
    'documento',
    'identificacion',
    'identificacion proveedor',
    'nit emisor',
    'nit proveedor',
    'nit',
  ],
  supplierName: ['nombre tercero', 'nombre emisor', 'nombre proveedor'],
  documentPrefix: ['prefijo', 'prefijo documento'],
  documentNumber: ['consecutivo', 'numero', 'nro consecutivo', 'no consecutivo'],
  itemDescription: [
    'descripcion',
    'detalle',
    'concepto',
    'descripcion item',
  ],
  quantity: ['cantidad', 'cant'],
  unitValue: ['valor unitario', 'vr unitario', 'precio unitario', 'v unitario'],
  dueDate: ['fecha vencimiento'],
  cufe: ['cufe', 'cude', 'cufe/cude'],
  receiverIdentification: ['nit receptor', 'nit empresa', 'nit comprador'],
  currency: ['moneda'],
  lineTotal: ['total', 'valor total', 'vr total', 'total linea'],
  taxAmount: ['iva', 'valor iva', 'impuesto', 'valor impuesto'],
  observations: ['observaciones', 'comentarios', 'observacion', 'comentario'],
} as const;

const REQUIRED_COLUMN_KEYS = [
  'supplierDocumentType',
  'supplierIdentification',
  'documentPrefix',
  'documentNumber',
  'issueDate',
  'itemDescription',
] as const;

type SupportDocumentColumnKey = keyof typeof COLUMN_ALIASES;
type RequiredSupportDocumentColumnKey = (typeof REQUIRED_COLUMN_KEYS)[number];

export function parseSupportDocumentExcel(
  buffer: Buffer,
): GroupedSupportDocument[] {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new InvalidExcelFormatException(
      'No se pudo leer el archivo Excel de Documentos Soporte.',
    );
  }

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new InvalidExcelFormatException('El archivo Excel no contiene hojas.');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });

  const matrixResult = parseSupportDocumentMatrix(matrix);

  if (matrixResult) {
    return matrixResult;
  }

  const objectResult = parseSupportDocumentObjects(sheet);

  if (objectResult) {
    return objectResult;
  }

  throw new InvalidExcelFormatException(
    `No se encontraron las columnas requeridas del Documento Soporte (${REQUIRED_COLUMNS_MESSAGE}). Encabezados detectados: ${describeDetectedHeaders(matrix)}`,
  );
}

function parseSupportDocumentMatrix(
  matrix: Array<Array<string | number>>,
): GroupedSupportDocument[] | null {
  const headerRowIndex = findHeaderRowIndex(matrix);

  if (headerRowIndex === -1) {
    return null;
  }

  const columnIndexes = mapColumnIndexes(matrix[headerRowIndex] ?? []);

  if (!columnIndexes) {
    return null;
  }

  return parseRowsFromMatrix(matrix, headerRowIndex, columnIndexes);
}

function parseSupportDocumentObjects(
  sheet: XLSX.WorkSheet,
): GroupedSupportDocument[] | null {
  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
    blankrows: false,
  });

  if (objectRows.length === 0) {
    return null;
  }

  const headerKeys = Object.keys(objectRows[0] ?? {});

  if (headerKeys.length === 0) {
    return null;
  }

  const columnIndexes = mapColumnIndexes(headerKeys);

  if (!columnIndexes) {
    return null;
  }

  const rows: SupportDocumentExcelRow[] = [];

  for (const objectRow of objectRows) {
    const matrixRow = headerKeys.map((key) => {
      const value = objectRow[key];

      if (value === undefined || value === null) {
        return '';
      }

      return value as string | number;
    });
    const parsedRow = mapSupportDocumentRow(matrixRow, columnIndexes);

    if (parsedRow) {
      rows.push(parsedRow);
    }
  }

  if (rows.length === 0) {
    return null;
  }

  return groupSupportDocumentRows(rows);
}

function parseRowsFromMatrix(
  matrix: Array<Array<string | number>>,
  headerRowIndex: number,
  columnIndexes: Record<RequiredSupportDocumentColumnKey, number> &
    Partial<Record<SupportDocumentColumnKey, number>>,
): GroupedSupportDocument[] {
  const rows: SupportDocumentExcelRow[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex++) {
    const parsedRow = mapSupportDocumentRow(
      matrix[rowIndex] ?? [],
      columnIndexes,
    );

    if (parsedRow) {
      rows.push(parsedRow);
    }
  }

  if (rows.length === 0) {
    throw new InvalidExcelFormatException(
      'El archivo no contiene filas válidas de Documentos Soporte después del encabezado.',
    );
  }

  return groupSupportDocumentRows(rows);
}

export function groupSupportDocumentRows(
  rows: SupportDocumentExcelRow[],
): GroupedSupportDocument[] {
  const groups = new Map<string, GroupedSupportDocument>();

  for (const row of rows) {
    const groupKey = buildSupportDocumentGroupKey(
      row.supplierDocumentType,
      row.supplierIdentification,
      row.documentPrefix,
      row.documentNumber,
    );

    const existingGroup = groups.get(groupKey);

    if (existingGroup) {
      existingGroup.rows.push(row);

      if (!existingGroup.observations && row.observations?.trim()) {
        existingGroup.observations = row.observations.trim();
      }

      continue;
    }

    groups.set(groupKey, {
      groupKey,
      supplierIdentification: row.supplierIdentification,
      supplierDocumentType: row.supplierDocumentType,
      supplierName: row.supplierName,
      documentPrefix: row.documentPrefix,
      documentNumber: row.documentNumber,
      issueDate: row.issueDate ?? '',
      dueDate: row.dueDate,
      cufe: row.cufe,
      receiverIdentification: row.receiverIdentification,
      currency: row.currency?.trim() || 'COP',
      observations: row.observations?.trim() || undefined,
      rows: [row],
    });
  }

  return [...groups.values()];
}

export function buildSupportDocumentGroupKey(
  supplierDocumentType: string,
  supplierIdentification: string,
  documentPrefix: string,
  documentNumber: string,
): string {
  return [
    normalizeSupportDocumentType(supplierDocumentType),
    normalizeIdentification(supplierIdentification),
    documentPrefix.trim().toUpperCase(),
    documentNumber.trim(),
  ].join('|');
}

function findHeaderRowIndex(matrix: Array<Array<string | number>>): number {
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex++) {
    if (mapColumnIndexes(matrix[rowIndex] ?? [])) {
      return rowIndex;
    }
  }

  return -1;
}

function mapColumnIndexes(
  headerRow: Array<string | number>,
): (Record<RequiredSupportDocumentColumnKey, number> &
  Partial<Record<SupportDocumentColumnKey, number>>) | null {
  const normalizedHeaders = headerRow.map((cell) => normalizeHeader(cell));
  const indexes = {} as Record<SupportDocumentColumnKey, number>;
  const usedIndexes = new Set<number>();

  for (const columnKey of REQUIRED_COLUMN_KEYS) {
    const columnIndex = findColumnIndex(
      normalizedHeaders,
      COLUMN_ALIASES[columnKey],
      usedIndexes,
    );

    if (columnIndex === -1) {
      return null;
    }

    indexes[columnKey] = columnIndex;
    usedIndexes.add(columnIndex);
  }

  for (const [columnKey, aliases] of Object.entries(COLUMN_ALIASES) as Array<
    [SupportDocumentColumnKey, readonly string[]]
  >) {
    if (indexes[columnKey] !== undefined) {
      continue;
    }

    const columnIndex = findColumnIndex(
      normalizedHeaders,
      aliases,
      usedIndexes,
    );

    if (columnIndex !== -1) {
      indexes[columnKey] = columnIndex;
      usedIndexes.add(columnIndex);
    }
  }

  return indexes as Record<RequiredSupportDocumentColumnKey, number> &
    Partial<Record<SupportDocumentColumnKey, number>>;
}

function findColumnIndex(
  normalizedHeaders: string[],
  aliases: readonly string[],
  usedIndexes: Set<number>,
): number {
  for (let columnIndex = 0; columnIndex < normalizedHeaders.length; columnIndex++) {
    if (usedIndexes.has(columnIndex)) {
      continue;
    }

    if (headerMatches(normalizedHeaders[columnIndex] ?? '', aliases)) {
      return columnIndex;
    }
  }

  return -1;
}

function headerMatches(header: string, aliases: readonly string[]): boolean {
  if (!header) {
    return false;
  }

  if (aliases.includes(header as (typeof aliases)[number])) {
    return true;
  }

  const compactHeader = compactHeaderValue(header);

  return aliases.some((alias) => {
    const compactAlias = compactHeaderValue(alias);

    return (
      compactHeader === compactAlias ||
      compactHeader.startsWith(compactAlias) ||
      compactHeader.endsWith(compactAlias)
    );
  });
}

function mapSupportDocumentRow(
  row: Array<string | number>,
  columnIndexes: Record<RequiredSupportDocumentColumnKey, number> &
    Partial<Record<SupportDocumentColumnKey, number>>,
): SupportDocumentExcelRow | null {
  const supplierIdentification = normalizeIdentification(
    getCellValue(row, columnIndexes.supplierIdentification),
  );
  const supplierDocumentType = normalizeSupportDocumentType(
    getCellValue(row, columnIndexes.supplierDocumentType),
  );
  const supplierName = getCellValue(row, columnIndexes.supplierName);
  const documentPrefix = getCellValue(row, columnIndexes.documentPrefix).toUpperCase();
  const documentNumber = getCellValue(row, columnIndexes.documentNumber);
  const itemDescription = getCellValue(row, columnIndexes.itemDescription);

  if (
    !supplierIdentification &&
    !documentPrefix &&
    !documentNumber &&
    !itemDescription
  ) {
    return null;
  }

  if (
    !supplierIdentification ||
    !documentPrefix ||
    !documentNumber ||
    !itemDescription
  ) {
    return null;
  }

  const issueDate = normalizeOptionalDate(
    getCellValue(row, columnIndexes.issueDate),
  );

  if (!issueDate) {
    return null;
  }

  const quantity = getNumberValue(row, columnIndexes.quantity, 1);
  const unitValue = getNumberValue(row, columnIndexes.unitValue, 0);
  const lineTotal = getNumberValue(
    row,
    columnIndexes.lineTotal,
    quantity * unitValue,
  );

  return {
    supplierIdentification,
    supplierDocumentType,
    supplierName,
    documentPrefix,
    documentNumber,
    issueDate,
    dueDate: normalizeOptionalDate(getCellValue(row, columnIndexes.dueDate)),
    cufe: getCellValue(row, columnIndexes.cufe) || undefined,
    receiverIdentification: normalizeIdentification(
      getCellValue(row, columnIndexes.receiverIdentification),
    ),
    currency: getCellValue(row, columnIndexes.currency) || 'COP',
    itemDescription,
    quantity,
    unitValue,
    lineTotal,
    taxAmount: getNumberValue(row, columnIndexes.taxAmount, 0),
    observations: getCellValue(row, columnIndexes.observations) || undefined,
  };
}

function describeDetectedHeaders(matrix: Array<Array<string | number>>): string {
  const samples = matrix
    .slice(0, 5)
    .map((row, rowIndex) => {
      const cells = row
        .map((cell) => String(cell ?? '').trim())
        .filter(Boolean);

      if (cells.length === 0) {
        return null;
      }

      return `fila ${rowIndex + 1}: ${cells.join(' | ')}`;
    })
    .filter((sample): sample is string => Boolean(sample));

  return samples.length > 0 ? samples.join('; ') : 'sin filas legibles';
}

function getCellValue(
  row: Array<string | number>,
  columnIndex?: number,
): string {
  if (columnIndex === undefined) {
    return '';
  }

  const value = row[columnIndex];

  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function getNumberValue(
  row: Array<string | number>,
  columnIndex: number | undefined,
  fallback: number,
): number {
  const rawValue = getCellValue(row, columnIndex);

  if (!rawValue) {
    return fallback;
  }

  const normalized = rawValue.replace(/[^\d,.-]/g, '').replace(',', '.');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIdentification(value: string): string {
  return value.replace(/[^\dA-Za-z]/g, '').trim().toUpperCase();
}

function normalizeHeader(value: string | number): string {
  return String(value)
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[*:;.,]+$/g, '')
    .replace(/^[*:;.,]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactHeaderValue(value: string): string {
  return normalizeHeader(value).replace(/[^a-z0-9]/g, '');
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return new Date().toISOString().slice(0, 10);
  }

  return (
    matchIsoDate(trimmed) ??
    convertDayMonthYearToIso(trimmed, { allowDotSeparator: true }) ??
    trimmed
  );
}

function normalizeOptionalDate(value: string): string | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  return normalizeDate(trimmed);
}
