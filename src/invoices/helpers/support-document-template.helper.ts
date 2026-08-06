import * as XLSX from 'xlsx';

export const SUPPORT_DOCUMENT_TEMPLATE_FILENAME =
  'plantilla-documento-soporte.xlsx';

const TEMPLATE_HEADERS = [
  'Fecha',
  'Tipo de documento',
  'Numero de documento',
  'Nombre tercero',
  'Prefijo',
  'Consecutivo',
  'Descripcion',
  'Cantidad',
  'Valor unitario',
  'Observaciones',
] as const;

const TEMPLATE_EXAMPLE_ROWS: string[][] = [
  [
    '2026-06-10',
    'NIT',
    '900123456',
    'Proveedor Ejemplo S.A.S.',
    'DS',
    '100',
    'Servicio de consultoría',
    '1',
    '150000',
    'Observaciones del documento soporte',
  ],
  [
    '2026-06-10',
    'CC',
    '1234567890',
    'Juan Pérez',
    'DS',
    '101',
    'Papelería',
    '2',
    '25000',
    'Compra de insumos de oficina',
  ],
  [
    '2026-06-10',
    'CC',
    '1234567890',
    'Juan Pérez',
    'DS',
    '101',
    'Transporte',
    '1',
    '80000',
    'Compra de insumos de oficina',
  ],
];

export function buildSupportDocumentTemplateExcel(
  includeSupplierName = true,
): Buffer {
  const supplierNameIndex = TEMPLATE_HEADERS.indexOf('Nombre tercero');
  const headers = includeSupplierName
    ? [...TEMPLATE_HEADERS]
    : TEMPLATE_HEADERS.filter((_, index) => index !== supplierNameIndex);
  const rows = includeSupplierName
    ? TEMPLATE_EXAMPLE_ROWS
    : TEMPLATE_EXAMPLE_ROWS.map((row) =>
        row.filter((_, index) => index !== supplierNameIndex),
      );
  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows,
  ]);

  const columns = [
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 30 },
    { wch: 10 },
    { wch: 14 },
    { wch: 36 },
  ];
  worksheet['!cols'] = includeSupplierName
    ? columns
    : columns.filter((_, index) => index !== supplierNameIndex);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Documentos soporte');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}
