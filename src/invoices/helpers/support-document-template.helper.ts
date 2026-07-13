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
  ],
];

export function buildSupportDocumentTemplateExcel(): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...TEMPLATE_HEADERS],
    ...TEMPLATE_EXAMPLE_ROWS,
  ]);

  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 18 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 30 },
    { wch: 10 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Documentos soporte');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}
