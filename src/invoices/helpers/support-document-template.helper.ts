import ExcelJS from 'exceljs';

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
  'Centro de costos',
  'Observaciones',
] as const;

const COLUMN_WIDTHS = [14, 20, 20, 30, 12, 14, 32, 12, 16, 26, 38];

const HEADER_FILL_COLOR = 'FF2F5233';
const HEADER_ROW_HEIGHT = 26;
const DATA_ROW_HEIGHT = 20;
const THIN_BORDER: Partial<ExcelJS.Border> = {
  style: 'thin',
  color: { argb: 'FFD9D9D9' },
};

/** Cuántas filas de datos traen las listas desplegables (Tipo de documento,
 * Centro de costos) — un tope generoso (no "todas las filas posibles del
 * Excel") porque ExcelJS necesita un rango fijo de celdas para la
 * validación, no puede aplicarse a "toda la columna" de forma perezosa. */
const DROPDOWN_ROWS = 500;

/** Tipos de documento que acepta el desplegable — el importador también
 * reconoce CE/PA escritos a mano (ver normalizeSupportDocumentType), pero
 * NIT/CC son los únicos dos que se piden como opción fija en la plantilla. */
const DOCUMENT_TYPE_OPTIONS = ['NIT', 'CC'];

function getTodayFormatted(): string {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Mismo formato "código - nombre" que ya usa la app en el selector de
 * centro de costos (ver formatCostCenterOptionLabel en el frontend) — así
 * el valor que cae en el Excel es reconocible para el usuario y, al volver
 * a importar, alcanza con separar por el primer " - " para recuperar el
 * código exacto sin ambigüedad. */
function formatCostCenterLabel(costCenter: {
  code: string;
  name: string;
}): string {
  return `${costCenter.code} - ${costCenter.name}`;
}

function buildTemplateExampleRows(exampleCostCenterLabel: string): string[][] {
  const todayFormatted = getTodayFormatted();

  return [
    [
      todayFormatted,
      'NIT',
      '900123456',
      'Proveedor Ejemplo S.A.S.',
      'DS',
      '100',
      'Servicio de consultoría',
      '1',
      '150000',
      exampleCostCenterLabel,
      'Observaciones del documento soporte',
    ],
    [
      todayFormatted,
      'CC',
      '1234567890',
      'Juan Pérez',
      'DS',
      '101',
      'Papelería',
      '2',
      '25000',
      exampleCostCenterLabel,
      'Compra de insumos de oficina',
    ],
    [
      todayFormatted,
      'CC',
      '1234567890',
      'Juan Pérez',
      'DS',
      '101',
      'Transporte',
      '1',
      '80000',
      exampleCostCenterLabel,
      'Compra de insumos de oficina',
    ],
  ];
}

export interface SupportDocumentTemplateCostCenter {
  code: string;
  name: string;
}

function applyListDataValidation(
  sheet: ExcelJS.Worksheet,
  columnIndex: number,
  formula: string,
  options: { errorTitle: string; error: string },
): void {
  const excelColumn = columnIndex + 1;

  for (let rowNumber = 2; rowNumber <= DROPDOWN_ROWS + 1; rowNumber += 1) {
    sheet.getCell(rowNumber, excelColumn).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: 'warning',
      errorTitle: options.errorTitle,
      error: options.error,
    };
  }
}

/**
 * Genera la plantilla de Documento Soporte. "Tipo de documento" siempre
 * trae la lista desplegable NIT/CC. "Centro de costos" trae una lista
 * desplegable con el catálogo real de SIIGO de la empresa cuando
 * `costCenters` trae datos — si la empresa no tiene centros de costos
 * configurados (o no se pudo consultar SIIGO), esa columna queda como
 * texto libre sin validación en vez de bloquear la descarga.
 */
export async function buildSupportDocumentTemplateExcel(
  costCenters: SupportDocumentTemplateCostCenter[] = [],
): Promise<Buffer> {
  // El nombre del tercero se resuelve por NIT (BD → SIIGO), no va en el Excel.
  const supplierNameIndex = TEMPLATE_HEADERS.indexOf('Nombre tercero');
  const headers = TEMPLATE_HEADERS.filter(
    (_, index) => index !== supplierNameIndex,
  );
  const documentTypeColumnIndex = headers.indexOf('Tipo de documento');
  const costCenterColumnIndex = headers.indexOf('Centro de costos');
  const exampleCostCenterLabel =
    costCenters.length > 0 ? formatCostCenterLabel(costCenters[0]) : '';
  const rows = buildTemplateExampleRows(exampleCostCenterLabel).map((row) =>
    row.filter((_, index) => index !== supplierNameIndex),
  );

  const columnWidths = COLUMN_WIDTHS.filter(
    (_, index) => index !== supplierNameIndex,
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Documentos soporte', {
    properties: { defaultRowHeight: DATA_ROW_HEIGHT },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = headers.map((header, index) => ({
    header,
    width: columnWidths[index],
  }));

  const headerRow = sheet.getRow(1);
  headerRow.height = HEADER_ROW_HEIGHT;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_FILL_COLOR },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    cell.border = { bottom: THIN_BORDER };
  });

  for (const row of rows) {
    const addedRow = sheet.addRow(row);
    addedRow.height = DATA_ROW_HEIGHT;
    addedRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'middle' };
      cell.border = {
        top: THIN_BORDER,
        left: THIN_BORDER,
        bottom: THIN_BORDER,
        right: THIN_BORDER,
      };
    });
  }

  // Filtro rápido por columna — ayuda a ubicar filas cuando el Excel ya
  // tiene muchas (el encabezado congelado ya se configuró al crear la hoja).
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };

  // Lista corta y sin comas dentro de cada opción — alcanza con una fórmula
  // inline, no hace falta la hoja auxiliar que sí necesita Centro de costos.
  applyListDataValidation(
    sheet,
    documentTypeColumnIndex,
    `"${DOCUMENT_TYPE_OPTIONS.join(',')}"`,
    {
      errorTitle: 'Tipo de documento no reconocido',
      error: `Elegí ${DOCUMENT_TYPE_OPTIONS.join(' o ')} de la lista.`,
    },
  );

  if (costCenters.length > 0) {
    // Hoja auxiliar oculta con la lista de centros de costo — ExcelJS exige
    // un rango fijo de celdas para la validación tipo "list" referenciada
    // por fórmula (no puede apuntar a "toda la columna" de otra hoja de
    // forma dinámica, ni sirve una fórmula inline: los nombres pueden traer
    // comas o superar el límite de 255 caracteres de Excel), así que se usa
    // esta hoja como fuente.
    const costCenterSheet = workbook.addWorksheet('CentrosCosto');
    costCenterSheet.state = 'veryHidden';

    costCenters.forEach((costCenter, index) => {
      costCenterSheet.getCell(index + 1, 1).value =
        formatCostCenterLabel(costCenter);
    });

    applyListDataValidation(
      sheet,
      costCenterColumnIndex,
      `CentrosCosto!$A$1:$A$${costCenters.length}`,
      {
        errorTitle: 'Centro de costos no reconocido',
        error:
          'Elegí un centro de costos de la lista — si no aparece ninguno, dejá la celda vacía.',
      },
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return Buffer.from(buffer);
}
