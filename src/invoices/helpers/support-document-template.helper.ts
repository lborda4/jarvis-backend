import ExcelJS from 'exceljs';

export const SUPPORT_DOCUMENT_TEMPLATE_FILENAME =
  'plantilla-documento-soporte.xlsx';

const DATA_ROWS = 500;
const SHEET_NAME = 'Documentos soporte';

const COLUMNS = [
  {
    header: 'Fecha',
    width: 13,
    required: true,
    format: 'dd/mm/yyyy',
    help: 'Fecha del documento en formato día/mes/año.',
  },
  {
    header: 'Tipo de identificación',
    width: 17,
    required: true,
    format: '@',
    help: 'Selecciona NIT, CC, CE o PA (pasaporte).',
  },
  {
    header: 'Número de identificación',
    width: 20,
    required: true,
    format: '@',
    help: 'Identificación del tercero, sin puntos ni espacios. Se conserva como texto para no perder ceros iniciales.',
  },
  {
    header: 'Prefijo',
    width: 10,
    required: true,
    format: '@',
    help: 'Prefijo del documento. Repite el prefijo y consecutivo para agregar ítems al mismo documento.',
  },
  {
    header: 'Consecutivo',
    width: 13,
    required: true,
    format: '0',
    help: 'Número entero positivo del documento, sin puntos ni separadores.',
  },
  {
    header: 'Descripcion',
    width: 28,
    required: true,
    format: '@',
    help: 'Descripción del producto o servicio de esta fila.',
  },
  {
    header: 'Cantidad',
    width: 11,
    required: true,
    format: '0.##',
    help: 'Cantidad mayor que cero. Admite decimales.',
  },
  {
    header: 'Valor unitario',
    width: 16,
    required: true,
    format: '#,##0.00',
    help: 'Valor numérico mayor o igual a cero, sin símbolo de moneda.',
  },
  {
    header: 'Cuenta contable',
    width: 26,
    required: false,
    format: '@',
    help: 'Selecciona una cuenta de la empresa o deja vacío para usar las sugerencias.',
  },
  {
    header: 'Centro de costos',
    width: 22,
    required: false,
    format: '@',
    help: 'Selecciona un centro de costos de la empresa, si aplica. Puedes dejarlo vacío.',
  },
  {
    header: 'Observaciones',
    width: 28,
    required: false,
    format: '@',
    help: 'Comentario del documento, si aplica. Puedes dejarlo vacío.',
  },
] as const;

type TemplateHeader = (typeof COLUMNS)[number]['header'];

export interface SupportDocumentTemplateCostCenter {
  code: string;
  name: string;
}

function todayInColombia(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((value) => value.type === type)!.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}

function columnIndex(header: TemplateHeader): number {
  return COLUMNS.findIndex((column) => column.header === header) + 1;
}

function applyValidation(
  sheet: ExcelJS.Worksheet,
  header: TemplateHeader,
  validation: ExcelJS.DataValidation,
): void {
  const column = COLUMNS[columnIndex(header) - 1];
  for (let row = 2; row <= DATA_ROWS + 1; row++) {
    sheet.getCell(row, columnIndex(header)).dataValidation = {
      allowBlank: !column.required,
      showInputMessage: true,
      promptTitle: column.required ? 'Obligatorio' : 'Opcional',
      prompt: column.help,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Revisa el valor ingresado',
      error: column.help,
      ...validation,
    };
  }
}

/** Los catálogos se guardan en columnas ocultas de la misma hoja para que
 * las listas largas funcionen sin pestañas auxiliares ni el límite de
 * 255 caracteres de las listas escritas directamente en la validación. */
function addCatalog(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  header: TemplateHeader,
  catalogColumn: string,
  rangeName: string,
  options: SupportDocumentTemplateCostCenter[],
): void {
  sheet.getColumn(catalogColumn).hidden = true;
  sheet.getColumn(catalogColumn).numFmt = '@';
  options.forEach((option, index) => {
    sheet.getCell(`${catalogColumn}${index + 2}`).value =
      `${option.code} - ${option.name}`;
  });
  workbook.definedNames.add(
    `'${SHEET_NAME}'!$${catalogColumn}$2:$${catalogColumn}$${options.length + 1}`,
    rangeName,
  );
  applyValidation(sheet, header, { type: 'list', formulae: [rangeName] });
}

export async function buildSupportDocumentTemplateExcel(
  costCenters: SupportDocumentTemplateCostCenter[] = [],
  accounts: Array<{ code: string; name: string }> = [],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    properties: { defaultRowHeight: 21 },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    style: {
      numFmt: column.format,
      font: { name: 'Calibri', size: 11, color: { argb: 'FF1F2937' } },
      alignment: { vertical: 'middle', wrapText: column.format === '@' },
    },
  }));
  sheet.getRow(1).height = 44;
  COLUMNS.forEach((column, index) => {
    const cell = sheet.getCell(1, index + 1);
    cell.value = column.required
      ? column.header
      : `${column.header} (opcional)`;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: column.required ? 'FF0F766E' : 'FF64748B',
      },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    cell.border = {
      right: { style: 'thin', color: { argb: 'FFD7DEE7' } },
      bottom: { style: 'medium', color: { argb: 'FF0D9488' } },
    };
    cell.note = `${column.required ? 'Obligatorio' : 'Opcional'}. ${column.help}`;
  });

  const example = sheet.addRow([
    todayInColombia(),
    'CC',
    '1234567890',
    'DS',
    100,
    'Servicio de consultoría',
    1,
    150000,
    null,
    null,
    null,
  ]);
  example.height = 24;
  example.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF3CD' },
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
  });
  example.getCell(1).note =
    'Fila de ejemplo: reemplázala con tus datos antes de subir el archivo. Cada fila corresponde a un ítem; repite identificación, prefijo y consecutivo para agrupar varios ítems en un documento.';

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  applyValidation(sheet, 'Fecha', {
    type: 'date',
    operator: 'between',
    formulae: [
      new Date(Date.UTC(1900, 0, 1)),
      new Date(Date.UTC(2100, 11, 31)),
    ],
  });
  applyValidation(sheet, 'Tipo de identificación', {
    type: 'list',
    formulae: ['"NIT,CC,CE,PA"'],
  });
  applyValidation(sheet, 'Número de identificación', {
    type: 'textLength',
    operator: 'between',
    formulae: [1, 30],
  });
  applyValidation(sheet, 'Prefijo', {
    type: 'textLength',
    operator: 'greaterThan',
    formulae: [0],
  });
  applyValidation(sheet, 'Consecutivo', {
    type: 'whole',
    operator: 'between',
    formulae: [1, 999999999999999],
  });
  applyValidation(sheet, 'Descripcion', {
    type: 'textLength',
    operator: 'greaterThan',
    formulae: [0],
  });
  applyValidation(sheet, 'Cantidad', {
    type: 'decimal',
    operator: 'greaterThan',
    formulae: [0],
  });
  applyValidation(sheet, 'Valor unitario', {
    type: 'decimal',
    operator: 'greaterThanOrEqual',
    formulae: [0],
  });

  for (const header of [
    'Cuenta contable',
    'Centro de costos',
    'Observaciones',
  ] as const) {
    applyValidation(sheet, header, {
      type: 'textLength',
      operator: 'greaterThanOrEqual',
      formulae: [0],
    });
  }
  if (costCenters.length) {
    addCatalog(
      workbook,
      sheet,
      'Centro de costos',
      'M',
      'CentrosCostoDocumentoSoporte',
      costCenters,
    );
  }
  if (accounts.length) {
    addCatalog(
      workbook,
      sheet,
      'Cuenta contable',
      'N',
      'CuentasDocumentoSoporte',
      accounts,
    );
  }

  for (let row = 3; row <= DATA_ROWS + 1; row++) {
    COLUMNS.forEach((_, index) => {
      const cell = sheet.getCell(row, index + 1);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: row % 2 === 0 ? 'FFF0FDFA' : 'FFFFFFFF' },
      };
      cell.border = {
        right: { style: 'hair', color: { argb: 'FFD7DEE7' } },
        bottom: { style: 'hair', color: { argb: 'FFD7DEE7' } },
      };
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
