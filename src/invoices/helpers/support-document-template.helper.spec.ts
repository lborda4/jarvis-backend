import ExcelJS from 'exceljs';
import { buildSupportDocumentTemplateExcel } from './support-document-template.helper';
import { parseSupportDocumentExcel } from './support-document-excel.helper';
import { validateSupportDocumentExcelRows } from './support-document-import-validation.helper';

async function loadTemplate(
  costCenters: Array<{ code: string; name: string }> = [],
  accounts: Array<{ code: string; name: string }> = [],
) {
  const buffer = await buildSupportDocumentTemplateExcel(costCenters, accounts);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  return { workbook, sheet: workbook.worksheets[0], buffer };
}

describe('plantilla masiva de documento soporte', () => {
  it('conserva una sola hoja y permite listas largas con comas en sus opciones', async () => {
    const accounts = Array.from({ length: 510 }, (_, index) => ({
      code: `51${index}`,
      name: `Servicios, cuenta de ejemplo ${index}`,
    }));
    const { workbook, sheet, buffer } = await loadTemplate(
      [{ code: '001', name: 'Administración, Bogotá' }],
      accounts,
    );

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      'Documentos soporte',
    ]);
    expect(sheet.getColumn('M').hidden).toBe(true);
    expect(sheet.getColumn('N').hidden).toBe(true);
    expect(sheet.getCell('M2').value).toBe('001 - Administración, Bogotá');
    expect(sheet.getCell('N511').value).toBe(
      '51509 - Servicios, cuenta de ejemplo 509',
    );
    expect(
      workbook.definedNames.getRanges('CuentasDocumentoSoporte').ranges,
    ).toEqual(["'Documentos soporte'!$N$2:$N$511"]);
    expect(sheet.getCell('I501').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['CuentasDocumentoSoporte'],
      allowBlank: true,
      errorStyle: 'stop',
    });
    expect(sheet.getCell('J501').dataValidation.formulae).toEqual([
      'CentrosCostoDocumentoSoporte',
    ]);
    // Las filas del catálogo en columnas ocultas no se importan como documentos.
    expect(parseSupportDocumentExcel(buffer)).toHaveLength(1);
    sheet.getCell('I2').value = sheet.getCell('N511').value;
    sheet.getCell('J2').value = sheet.getCell('M2').value;
    const groups = parseSupportDocumentExcel(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(groups[0].rows[0].account).toBe(
      '51509 - Servicios, cuenta de ejemplo 509',
    );
    expect(groups[0].costCenter).toBe('001 - Administración, Bogotá');
  });

  it('distingue fechas, números y texto y aplica validaciones hasta la fila 501', async () => {
    const { sheet } = await loadTemplate();

    expect(sheet.getCell('A2').value).toBeInstanceOf(Date);
    expect(sheet.getCell('A501').numFmt).toBe('dd/mm/yyyy');
    expect(sheet.getCell('A501').dataValidation.type).toBe('date');
    expect(sheet.getCell('B501').dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"NIT,CC,CE,PA"'],
      errorStyle: 'stop',
    });
    expect(sheet.getCell('C501').numFmt).toBe('@');
    expect(sheet.getCell('E2').value).toBe(100);
    expect(sheet.getCell('E501').numFmt).toBe('0');
    expect(sheet.getCell('E501').dataValidation).toMatchObject({
      type: 'whole',
      formulae: [1, 999999999999999],
    });
    expect(sheet.getCell('G2').value).toBe(1);
    expect(sheet.getCell('G501').dataValidation).toMatchObject({
      type: 'decimal',
      operator: 'greaterThan',
      formulae: [0],
    });
    expect(sheet.getCell('H2').value).toBe(150000);
    expect(sheet.getCell('H501').dataValidation).toMatchObject({
      type: 'decimal',
      operator: 'greaterThanOrEqual',
      formulae: [0],
    });
    expect(sheet.getCell('I501').dataValidation).toMatchObject({
      allowBlank: true,
      promptTitle: 'Opcional',
    });
    expect(sheet.getCell('I1').value).toBe('Cuenta contable (opcional)');
    expect(sheet.getCell('J2').value).toBeNull();
    expect(sheet.getCell('A2').note).toContain('reemplázala');
  });

  it('importa el ejemplo y los nuevos encabezados conservando ceros, decimales y varios ítems', async () => {
    jest
      .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] })
      .setSystemTime(new Date('2026-11-18T02:00:00Z'));
    try {
      const { workbook, sheet } = await loadTemplate();
      sheet.getCell('C2').value = '0012345678';
      sheet.getCell('G2').value = 1.5;
      sheet.getCell('H2').value = 25000.25;
      const second = sheet.getRow(2).values as ExcelJS.CellValue[];
      sheet.getRow(3).values = second;
      sheet.getCell('F3').value = 'Segundo servicio';
      sheet.getCell('G3').value = 2;
      const groups = parseSupportDocumentExcel(
        Buffer.from(await workbook.xlsx.writeBuffer()),
      );

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        supplierDocumentType: 'CC',
        supplierIdentification: '0012345678',
        issueDate: '2026-11-17',
        documentPrefix: 'DS',
        documentNumber: '100',
      });
      expect(groups[0].rows).toHaveLength(2);
      expect(groups[0].rows[0]).toMatchObject({
        quantity: 1.5,
        unitValue: 25000.25,
        lineTotal: 37500.375,
      });
      expect(validateSupportDocumentExcelRows(groups).invalidGroups).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
