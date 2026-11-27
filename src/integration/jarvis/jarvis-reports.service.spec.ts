import { Workbook } from 'exceljs';
import {
  JarvisReportsService,
  validateReportQuery,
} from './jarvis-reports.service';
import {
  allocateReportAmount,
  calculateJarvisReport,
} from './helpers/jarvis-report-calculation.helper';
import type { ReportDocument, ReportQuery } from './jarvis-reports.types';
import { JarvisReportsController } from './jarvis-reports.controller';
import { addTaxDetailSheet } from './helpers/jarvis-tax-detail-export.helper';
import { addCustomerReportSheet, addProductReportSheet } from './helpers/jarvis-customer-report-export.helper';

it('concilia ventas netas con descuentos posteriores a impuestos en notas débito', () => {
  const debit = invoice({ kind: 'DEBIT_NOTE', total: '109' });
  debit.source!.discountAmount = 10;
  const result = calculateJarvisReport([debit], filters());
  expect(result.detail[0]).toMatchObject({
    subtotal: 100,
    discount: 10,
    netSales: 90,
    iva: 19,
    total: 109,
  });
  expect(result.totals[0]).toMatchObject({
    debitNotes: 90,
    netSales: 90,
    ivaGenerated: 19,
    total: 109,
  });
});

it('separa el IVA generado en ventas del IVA registrado en documentos soporte', () => {
  const result = calculateJarvisReport(
    [invoice(), invoice({ id: 'support', kind: 'SUPPORT_DOCUMENT' })],
    filters({ report: 'taxes' }),
  );
  expect(result.totals[0]).toMatchObject({
    iva: 38,
    ivaGenerated: 19,
    netSales: 100,
  });
});

const query = { from: '2026-10-01', to: '2026-10-31' };
function filters(overrides: ReportQuery = {}) {
  return validateReportQuery({ ...query, ...overrides });
}
function invoice(overrides: Partial<ReportDocument> = {}): ReportDocument {
  return {
    id: 'invoice-1',
    kind: 'ELECTRONIC_INVOICE',
    date: '2026-10-15',
    number: 'FV1',
    customerId: '00123',
    customerName: 'Cliente',
    currency: 'COP',
    total: '119',
    source: {
      issueDate: '2026-10-15',
      customerDocumentType: 'CC',
      customerIdentification: '00123',
      items: [
        {
          code: 'A',
          description: 'Servicio A',
          quantity: 1,
          unitValue: 100,
          taxAmount: 19,
        },
      ],
    },
    ...overrides,
  };
}
function setup(documents: ReportDocument[] = []) {
  const source = {
    query: jest
      .fn<Promise<unknown[]>, [string, unknown[]]>()
      .mockImplementation(async (sql) => sql === 'SELECT name, nit FROM companies WHERE id=$1'
        ? [{ name: 'Empresa SAS', nit: '900123456' }]
        : documents),
  };
  const integrations = {
    findByCompanyAndProvider: jest.fn().mockResolvedValue({ id: 'jarvis' }),
  };
  return {
    source,
    integrations,
    service: new JarvisReportsService(source as never, integrations as never),
  };
}

it('consolida ventas, créditos negativos y débitos positivos sin mezclar monedas', () => {
  const sale = invoice();
  const credit = invoice({
    id: 'credit',
    kind: 'CREDIT_NOTE',
    number: 'NC1',
    total: '23.8',
    source: {
      ...sale.source!,
      items: [
        {
          code: 'A',
          description: 'Servicio A',
          quantity: 0.2,
          unitValue: 100,
          taxAmount: 3.8,
        },
      ],
    },
  });
  const debit = invoice({
    id: 'debit',
    kind: 'DEBIT_NOTE',
    number: 'ND1',
    total: '11.9',
    source: {
      ...sale.source!,
      items: [
        {
          code: 'A',
          description: 'Servicio A',
          quantity: 0.1,
          unitValue: 100,
          taxAmount: 1.9,
        },
      ],
    },
  });
  const result = calculateJarvisReport(
    [sale, credit, debit, invoice({ id: 'dollar', currency: 'USD' })],
    filters(),
  );
  expect(result.totals).toHaveLength(2);
  expect(result.totals[0]).toMatchObject({
    grossSales: 100,
    creditNotes: -20,
    debitNotes: 10,
    netSales: 90,
    iva: 17.1,
    total: 107.1,
    invoiceCount: 1,
    creditCount: 1,
    debitCount: 1,
  });
  expect(result.totals[1]).toMatchObject({ currency: 'USD', total: 119 });
  expect(result.summary.find((row) => row.kind === 'Nota crédito')?.total).toBe(
    -23.8,
  );
  const products = calculateJarvisReport(
    [sale, credit, debit],
    filters({ report: 'products' }),
  );
  expect(products.summary[0]).toMatchObject({
    soldQuantity: 1,
    returnedQuantity: 0.2,
    debitQuantity: 0.1,
    netQuantity: 0.9,
    subtotal: 90,
  });
  expect(products.detail[1]).toMatchObject({
    quantity: -0.2,
    unitValue: 100,
    total: -23.8,
  });
  expect(products.totals[0]).toMatchObject({
    soldQuantity: 1,
    returnedQuantity: 0.2,
    netQuantity: 0.9,
  });
});

it.each(['summary', 'detail'])('exporta ventas por producto en una hoja con vista %s y conserva cantidades y monedas', async view => {
  const sale = invoice({ prefix: 'FV', number: 'FV001' });
  const credit = invoice({ id: 'credit', kind: 'CREDIT_NOTE', number: 'NC1', total: '23.8',
    source: { ...sale.source!, items: [{ code: 'A', description: 'Servicio A', quantity: 0.2, unitValue: 100, taxAmount: 3.8 }] } });
  const debit = invoice({ id: 'debit', kind: 'DEBIT_NOTE', number: 'ND1', total: '11.9',
    source: { ...sale.source!, items: [{ code: 'A', description: 'Servicio A', quantity: 0.1, unitValue: 100, taxAmount: 1.9 }] } });
  const dollar = invoice({ id: 'usd', currency: 'USD', number: 'FV2' });
  const { service, source } = setup([sale, credit, debit, dollar]);
  const exported = await service.export('company-a', { ...query, report: 'products', view, page: '2', pageSize: '10' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  expect(workbook.worksheets).toHaveLength(1);
  const sheet = workbook.getWorksheet('Ventas por producto')!;
  expect(sheet.getCell('A2').value).toBe('Ventas por producto');
  expect(sheet.getCell('A3').value).toBe('Empresa SAS');
  expect(sheet.getCell('A4').value).toBe('900123456');
  const columns = sheet.getRow(7).values as string[];
  const get = (row: number, label: string) => sheet.getRow(row).getCell(columns.indexOf(label)).value;
  expect(get(8, 'Código producto')).toBe('A');
  expect(get(8, 'Cantidad vendida')).toBe(1);
  expect(get(8, 'Cantidad devuelta')).toBe(0.2);
  expect(get(8, 'Cantidad notas débito')).toBe(0.1);
  expect(get(8, 'Cantidad neta')).toBe(0.9);
  expect(get(8, 'Subtotal')).toBe(90);
  expect(get(8, 'Impuestos a cargo')).toBe(17.1);
  expect(get(8, 'Valor total')).toBe(107.1);
  expect(get(9, 'Moneda')).toBe('USD');
  expect(sheet.getCell('A10').value).toBe('Total · COP');
  expect(get(10, 'Cantidad neta')).toBe(0.9);
  expect(sheet.getCell('A11').value).toBe('Total · USD');
  expect(columns).not.toContain('Referencia fábrica');
  expect(columns).not.toContain('Grupo inventario');
  const rows: unknown[][] = [];
  sheet.eachRow(row => rows.push(row.values as unknown[]));
  expect(rows.some(row => row.includes('Detalle de comprobantes'))).toBe(view === 'detail');
  if (view === 'detail') {
    expect(rows.some(row => row.includes('FV001'))).toBe(true);
    expect(rows.some(row => row.includes('NC1'))).toBe(true);
    expect(rows.some(row => row.includes('FV-001'))).toBe(false);
  }
  expect(source.query).toHaveBeenCalledWith('SELECT name, nit FROM companies WHERE id=$1', ['company-a']);
});

it('exporta todos los productos filtrados sin limitarse a la página y advierte sobre comprobantes sin desglose', async () => {
  const docs = Array.from({ length: 25 }, (_, index) => {
    const doc = invoice({ id: String(index), number: `FV${index}` });
    doc.source!.items[0].code = `P${String(index).padStart(2, '0')}`;
    return doc;
  });
  const { service } = setup([...docs, invoice({ id: 'legacy', source: null })]);
  const exported = await service.export('company-a', { ...query, report: 'products', view: 'detail', product: 'P', page: '2', pageSize: '10' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow(row => rows.push(row.values as unknown[]));
  expect(sheet.getCell('A8').value).toBe('P00');
  expect(sheet.getCell('A32').value).toBe('P24');
  expect(rows.some(row => row.includes('FV24'))).toBe(true);
  expect(rows.some(row => row.some(value => typeof value === 'string' && value.includes('no conservan desglose suficiente')))).toBe(true);
  expect(rows.some(row => row.some(value => typeof value === 'string' && value.includes('producto P')))).toBe(true);
});

it('genera el informe de productos sin resultados y rechaza el exceso de filas', async () => {
  const { service } = setup();
  const exported = await service.export('company-a', { ...query, report: 'products', view: 'detail' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  expect(workbook.worksheets).toHaveLength(1);
  expect(workbook.worksheets[0].getCell('A7').value).toBe('Código producto');
  expect(() => addProductReportSheet(new Workbook(), { name: 'Empresa', nit: '1' },
    filters({ report: 'products', view: 'detail' }), new Array(1048576), [], [], [], [],
  )).toThrow('límite de filas');
});

it('agrupa por identificación y tipo del cliente, preservando ceros iniciales', () => {
  const first = invoice();
  const second = invoice({ id: 'second', number: 'FV2' });
  const otherType = invoice({
    id: 'third',
    source: { ...first.source!, customerDocumentType: 'NIT' },
  });
  const result = calculateJarvisReport(
    [first, second, otherType],
    filters({ report: 'customers' }),
  );
  expect(result.summary).toHaveLength(2);
  expect(result.summary[0]).toMatchObject({
    customerId: '00123',
    invoiceCount: 2,
    subtotal: 200,
    total: 238,
  });
});

  it.each(['summary', 'detail'])('exporta ventas por cliente en una hoja con vista %s', async view => {
    const sale = invoice({ prefix: 'FV', number: 'FV001' });
    const credit = invoice({ id: 'credit', kind: 'CREDIT_NOTE', number: 'NC1', total: '23.8',
      source: { ...sale.source!, items: [{ description: 'Servicio', quantity: 0.2, unitValue: 100, taxAmount: 3.8 }] } });
    const dollar = invoice({ id: 'usd', currency: 'USD', number: 'FV2' });
    const { service, source } = setup([sale, credit, dollar]);
    const exported = await service.export('company-a', { ...query, report: 'customers', view, page: '2', pageSize: '10' });
    const workbook = new Workbook();
    await workbook.xlsx.load(exported.buffer as never);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.getWorksheet('Ventas por cliente')!;
    expect(sheet.getCell('A2').value).toBe('Ventas por cliente');
    expect(sheet.getCell('A3').value).toBe('Empresa SAS');
    expect(sheet.getCell('A4').value).toBe('900123456');
    expect(sheet.getCell('A5').value).toContain('2026-10-01');
    const columns = sheet.getRow(7).values as string[];
    const customerId = columns.indexOf('Identificación');
    const count = columns.indexOf('Número de comprobantes');
    const subtotal = columns.indexOf('Subtotal');
    const taxes = columns.indexOf('Impuestos a cargo');
    expect(sheet.getRow(8).getCell(customerId).value).toBe('00123');
    expect(sheet.getRow(8).getCell(count).value).toBe(2);
    expect(sheet.getRow(8).getCell(subtotal).value).toBe(80);
    expect(sheet.getRow(8).getCell(taxes).value).toBe(15.2);
    expect(sheet.getCell('A10').value).toBe('Total · COP');
    expect(sheet.getCell('A11').value).toBe('Total · USD');
    const rows: unknown[][] = [];
    sheet.eachRow(row => rows.push(row.values as unknown[]));
    const detailTitle = rows.findIndex(row => row.includes('Detalle de comprobantes'));
    expect(detailTitle >= 0).toBe(view === 'detail');
    if (view === 'detail') {
      expect(rows.some(row => row.includes('FV001'))).toBe(true);
      expect(rows.some(row => row.includes('NC1'))).toBe(true);
      expect(rows.some(row => row.includes('FV-001'))).toBe(false);
    }
    expect(source.query).toHaveBeenCalledWith('SELECT name, nit FROM companies WHERE id=$1', ['company-a']);
  });

  it('exporta todos los clientes filtrados sin limitarse a la página y conserva datos desconocidos', async () => {
    const documents = Array.from({ length: 25 }, (_, index) =>
      invoice({ id: String(index), customerId: String(index).padStart(3, '0'), number: `FV${index}`, source: index === 0 ? null : invoice().source }),
    );
    const { service } = setup(documents);
    const exported = await service.export('company-a', { ...query, report: 'customers', view: 'summary', page: '2', pageSize: '10' });
    const workbook = new Workbook();
    await workbook.xlsx.load(exported.buffer as never);
    const sheet = workbook.worksheets[0];
    const columns = sheet.getRow(7).values as string[];
    expect(sheet.getCell('B8').value).toBe('000');
    expect(sheet.getCell('B32').value).toBe('024');
    expect(sheet.getRow(8).getCell(columns.indexOf('Impuestos a cargo')).value).toBeNull();
    expect(sheet.getRow(33).getCell(columns.indexOf('Impuestos a cargo')).value).toBeNull();
    expect(sheet.getCell('A33').value).toBe('Total · COP');
    const text: string[] = [];
    sheet.eachRow(row => { if (typeof row.getCell(1).value === 'string') text.push(String(row.getCell(1).value)); });
    expect(text.some(value => value.includes('no conservan desglose suficiente'))).toBe(true);
  });

  it('rechaza un reporte de clientes que excede el límite de una hoja', () => {
    expect(() => addCustomerReportSheet(new Workbook(), { name: 'Empresa', nit: '1' },
      filters({ report: 'customers', view: 'detail' }), new Array(1048576), [], [], [], [],
    )).toThrow('límite de filas');
  });

it('preserva el filtro de cliente y permite exportar sin resultados', async () => {
  const { service, source } = setup();
  const exported = await service.export('company-a', { ...query, report: 'customers', view: 'detail', customer: '00123' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  const sheet = workbook.worksheets[0];
  expect(workbook.worksheets).toHaveLength(1);
  expect(sheet.getCell('A7').value).toBe('Tipo de identificación');
  const rows: unknown[][] = [];
  sheet.eachRow(row => rows.push(row.values as unknown[]));
  expect(rows.some(row => row.includes('Detalle de comprobantes'))).toBe(true);
  expect(rows.some(row => row.some(value => typeof value === 'string' && value.includes('cliente 00123')))).toBe(true);
  expect(source.query.mock.calls[0][1]).toContain('00123');
});

it('no repite los totales de una factura con varias líneas', () => {
  const sale = invoice();
  sale.source!.items.push({
    code: 'B',
    description: 'Servicio B',
    quantity: 2,
    unitValue: 50,
    taxAmount: 19,
  });
  sale.total = '238';
  const documents = calculateJarvisReport([sale], filters());
  const products = calculateJarvisReport(
    [sale],
    filters({ report: 'products' }),
  );
  expect(documents.detail).toHaveLength(1);
  expect(documents.totals[0]).toMatchObject({
    invoiceCount: 1,
    subtotal: 200,
    total: 238,
  });
  expect(products.detail).toHaveLength(2);
  expect(products.totals[0]).toMatchObject({
    invoiceCount: 1,
    subtotal: 200,
    total: 238,
  });
  expect(products.detail.reduce((sum, row) => sum + Number(row.total), 0)).toBe(
    238,
  );
});

it('reparte descuentos y retenciones globales por producto conservando centavos', () => {
  const sale = invoice();
  sale.source!.items.push({
    code: 'B',
    description: 'Servicio B',
    quantity: 1,
    unitValue: 100,
    taxAmount: 19,
  });
  sale.source!.discountAmount = 0.01;
  sale.source!.retentions = [
    { id: 6, type: 'ReteRenta', percentage: 2.5 },
    { id: 5, type: 'ReteIVA', percentage: 15 },
    { id: 7, type: 'ReteICA', percentage: 9.66 },
  ];
  sale.total = '237.99';
  const all = calculateJarvisReport([sale], filters({ report: 'products' }));
  expect(all.totals[0]).toMatchObject({
    subtotal: 199.99,
    total: 237.99,
    retefuente: 5,
    reteIva: 5.7,
    reteIca: 1.93,
    payable: 225.36,
  });
  const selected = calculateJarvisReport(
    [sale],
    filters({ product: 'Servicio A' }),
  );
  expect(selected.detail).toHaveLength(1);
  expect(selected.totals[0].total).toBe(all.detail[0].total);
  expect(selected.totals[0].retefuente).toBe(2.5);
  expect(allocateReportAmount(1, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1);
  expect(allocateReportAmount(-1, [0, 0, 0]).reduce((a, b) => a + b, 0)).toBe(
    -1,
  );
});

it('diferencia retenciones que nos practicaron de las practicadas y sus ajustes', () => {
  const sale = invoice();
  sale.source!.items[0].retention = {
    id: 6,
    type: 'ReteRenta',
    percentage: 2.5,
  };
  const purchase = invoice({
    id: 'support',
    kind: 'SUPPORT_DOCUMENT',
    number: 'DS1',
    source: sale.source,
  });
  const adjustment = invoice({
    id: 'adjustment',
    kind: 'SUPPORT_CREDIT_NOTE',
    number: 'NDS1',
    source: sale.source,
  });
  const result = calculateJarvisReport(
    [sale, purchase, adjustment],
    filters({ report: 'taxes' }),
  );
  expect(result.detail[0]).toMatchObject({
    direction: 'Nos practicaron',
    retefuente: 2.5,
  });
  expect(result.detail[1]).toMatchObject({
    direction: 'Practicadas por nosotros',
    retefuente: 2.5,
  });
  expect(result.detail[2]).toMatchObject({
    direction: 'Practicadas por nosotros',
    retefuente: -2.5,
  });
  expect(result.totals[0]).toMatchObject({
    retentionsSuffered: 2.5,
    retentionsPracticed: 0,
    netSales: 100,
  });
  expect(
    calculateJarvisReport([sale, purchase], filters()).detail,
  ).toHaveLength(1);
});

it('descuenta créditos de IVA y retenciones y admite devoluciones de períodos anteriores', () => {
  const credit = invoice({ kind: 'CREDIT_NOTE' });
  credit.source!.retentions = [
    { id: 6, percentage: 2.5 },
    { id: 5, percentage: 15 },
    { id: 7, percentage: 9.66 },
  ];
  const result = calculateJarvisReport([credit], filters());
  expect(result.totals[0]).toMatchObject({
    netSales: -100,
    iva: -19,
    retefuente: -2.5,
    reteIva: -2.85,
    reteIca: -0.97,
    total: -119,
    payable: -112.68,
  });
});

it('respeta el descuento posimpuesto de notas débito y la base de retención de emisión', () => {
  const debit = invoice({ kind: 'DEBIT_NOTE', total: '109' });
  debit.source!.discountAmount = 10;
  debit.source!.retentions = [{ id: 6, type: 'ReteRenta', percentage: 2.5 }];
  expect(calculateJarvisReport([debit], filters()).detail[0]).toMatchObject({
    subtotal: 100,
    iva: 19,
    total: 109,
    retefuente: 2.5,
    payable: 106.5,
  });
});

it('no clasifica impuestos distintos al IVA como IVA', () => {
  const sale = invoice();
  sale.source!.items[0].taxId = 4;
  expect(calculateJarvisReport([sale], filters()).detail[0]).toMatchObject({
    iva: 0,
    otherTaxes: 19,
    total: 119,
  });
});

it('reparte entre vendedores sin duplicar importes y hereda vendedores en notas vinculadas', () => {
  const sale = invoice();
  sale.source!.sellers = [
    { id: 'seller-a', name: 'Ana' },
    { id: 'seller-b', name: 'Bruno' },
  ];
  const credit = invoice({
    id: 'credit',
    kind: 'CREDIT_NOTE',
    referenceSellers: sale.source!.sellers,
  });
  const result = calculateJarvisReport(
    [sale, credit],
    filters({ report: 'sellers' }),
  );
  expect(result.detail.map((row) => row.total)).toEqual([
    59.5, 59.5, -59.5, -59.5,
  ]);
  expect(result.totals[0]).toMatchObject({
    total: 0,
    invoiceCount: 1,
    creditCount: 1,
  });
  const selected = calculateJarvisReport(
    [sale],
    filters({ report: 'sellers', seller: 'Ana' }),
  );
  expect(selected.summary).toHaveLength(1);
  expect(selected.summary[0]).toMatchObject({
    seller: 'Ana',
    subtotal: 50,
    total: 59.5,
    participation: 100,
  });
  expect(selected.totals[0].total).toBe(59.5);
});

it.each(['summary', 'detail'])('exporta ventas por vendedor en una hoja con vista %s y respeta el reparto', async view => {
  const sale = invoice({ prefix: 'FV', number: 'FV001' });
  sale.source!.sellers = [{ id: 'seller-a', name: 'Ana' }, { id: 'seller-b', name: 'Bruno' }];
  const credit = invoice({ id: 'credit', kind: 'CREDIT_NOTE', number: 'NC1', referenceSellers: sale.source!.sellers });
  const dollar = invoice({ id: 'usd', currency: 'USD', number: 'FV2', source: { ...sale.source!, sellers: [{ id: 'seller-a', name: 'Ana' }] } });
  const { service, source } = setup([sale, credit, dollar]);
  const exported = await service.export('company-a', { ...query, report: 'sellers', view, page: '2', pageSize: '10' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  expect(workbook.worksheets).toHaveLength(1);
  const sheet = workbook.getWorksheet('Ventas por vendedor')!;
  expect(sheet.getCell('A2').value).toBe('Ventas por vendedor');
  expect(sheet.getCell('A3').value).toBe('Empresa SAS');
  expect(sheet.getCell('A4').value).toBe('900123456');
  const columns = sheet.getRow(7).values as string[];
  const count = columns.indexOf('Número de comprobantes');
  const total = columns.indexOf('Valor total');
  const participation = columns.indexOf('Participación en ventas netas (%)');
  expect(columns).not.toContain('Identificación');
  expect(sheet.getCell('A8').value).toBe('Ana');
  expect(sheet.getRow(8).getCell(count).value).toBe(2);
  expect(sheet.getRow(8).getCell(total).value).toBe(0);
  expect(sheet.getCell('A9').value).toBe('Bruno');
  expect(sheet.getRow(9).getCell(total).value).toBe(0);
  expect(sheet.getCell('A10').value).toBe('Ana');
  expect(sheet.getRow(10).getCell(total).value).toBe(119);
  expect(sheet.getRow(10).getCell(participation).value).toBe(100);
  expect(sheet.getCell('A11').value).toBe('Total · COP');
  expect(sheet.getCell('A12').value).toBe('Total · USD');
  const rows: unknown[][] = [];
  sheet.eachRow(row => rows.push(row.values as unknown[]));
  expect(rows.some(row => row.includes('Detalle de comprobantes'))).toBe(view === 'detail');
  if (view === 'detail') {
    expect(rows.filter(row => row.includes('FV001'))).toHaveLength(2);
    expect(rows.filter(row => row.includes('NC1'))).toHaveLength(2);
    expect(rows.some(row => row.includes('FV-001'))).toBe(false);
  }
  expect(rows.some(row => row.some(value => typeof value === 'string' && value.includes('reparten en partes iguales')))).toBe(true);
  expect(source.query).toHaveBeenCalledWith('SELECT name, nit FROM companies WHERE id=$1', ['company-a']);
});

it('exporta la participación filtrada del vendedor y no convierte importes desconocidos en cero', async () => {
  const sale = invoice();
  sale.source!.sellers = [{ id: 'seller-a', name: 'Ana' }, { id: 'seller-b', name: 'Bruno' }];
  const { service } = setup([sale]);
  const exported = await service.export('company-a', { ...query, report: 'sellers', view: 'summary', seller: 'Ana' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  const sheet = workbook.worksheets[0];
  const columns = sheet.getRow(7).values as string[];
  expect(sheet.getCell('A8').value).toBe('Ana');
  expect(sheet.getRow(8).getCell(columns.indexOf('Valor total')).value).toBe(59.5);
  expect(sheet.getCell('A9').value).toBe('Total · COP');
  const legacy = setup([invoice({ source: null })]);
  const legacyExport = await legacy.service.export('company-a', { ...query, report: 'sellers', view: 'detail' });
  const legacyWorkbook = new Workbook();
  await legacyWorkbook.xlsx.load(legacyExport.buffer as never);
  const legacySheet = legacyWorkbook.worksheets[0];
  expect(legacySheet.getCell('A8').value).toBe('Sin vendedor registrado');
  expect(legacySheet.getRow(8).getCell(columns.indexOf('Impuestos a cargo')).value).toBeNull();
});

it('exporta todas las filas por vendedor y admite resultados vacíos', async () => {
  const documents = Array.from({ length: 25 }, (_, index) => {
    const doc = invoice({ id: String(index), number: `FV${index}` });
    doc.source!.sellers = [{ id: `seller-${index}`, name: `Vendedor ${index}` }];
    return doc;
  });
  for (const input of [documents, []]) {
    const { service } = setup(input);
    const exported = await service.export('company-a', { ...query, report: 'sellers', view: 'detail', page: '2', pageSize: '10' });
    const workbook = new Workbook();
    await workbook.xlsx.load(exported.buffer as never);
    const values: unknown[][] = [];
    workbook.worksheets[0].eachRow(row => values.push(row.values as unknown[]));
    expect(workbook.worksheets).toHaveLength(1);
    expect(values.some(row => row.includes('Detalle de comprobantes'))).toBe(true);
    if (input.length) {
      expect(values.some(row => row.includes('Vendedor 24'))).toBe(true);
      expect(values.some(row => row.includes('FV24'))).toBe(true);
    }
  }
});

it('mantiene visibles comprobantes sin vendedor y marca el desglose que no existe', () => {
  const legacy = invoice({ source: null });
  const result = calculateJarvisReport(
    [legacy],
    filters({ report: 'sellers' }),
  );
  expect(result.detail[0]).toMatchObject({
    seller: 'Sin vendedor registrado',
    total: 119,
    subtotal: null,
    iva: null,
    payable: null,
  });
  expect(result.totals[0]).toMatchObject({ total: 119, netSales: null });
  expect(result.warnings.join(' ')).toContain('no conservan desglose');
  expect(
    calculateJarvisReport([legacy], filters({ report: 'products' })).detail,
  ).toHaveLength(0);
});

it.each([
  { from: '2026-02-30' },
  { from: '2026-11-01' },
  { report: 'not-a-report' },
  { view: 'all' },
  { page: '-1' },
  { page: '1.2' },
  { pageSize: '5000' },
  { kind: 'SUPPORT_DOCUMENT' },
  { currency: 'INVALID' },
])('rechaza filtros inválidos %j', (invalid) => {
  expect(() => filters(invalid)).toThrow();
});

it('consulta únicamente la empresa autenticada, rango y comprobantes aceptados, con parámetros SQL', async () => {
  const { service, source } = setup();
  await service.query('company-a', {
    ...query,
    customer: "' OR TRUE--",
    currency: 'COP',
  });
  const [sql, params] = source.query.mock.calls[0];
  expect(sql).toContain('i.company_id=$1');
  expect(sql).toContain('original.company_id=i.company_id');
  expect(sql).toContain('FROM jarvis_sales_invoices i');
  expect(sql).not.toContain('jarvis_invoice_drafts');
  expect(sql).not.toContain("' OR TRUE--");
  expect(params).toEqual([
    'company-a',
    query.from,
    query.to,
    ['ELECTRONIC_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'],
    'COP',
    "' OR TRUE--",
  ]);
});

it('no permite consultar sin empresa ni sin integración JARVIS', async () => {
  const { service, source, integrations } = setup();
  await expect(service.query('', query)).rejects.toThrow();
  integrations.findByCompanyAndProvider.mockResolvedValue(null);
  await expect(service.query('company-a', query)).rejects.toThrow();
  expect(source.query).not.toHaveBeenCalled();
});

it('pagina los registros después del filtro y conserva los totales globales', async () => {
  const documents = Array.from({ length: 25 }, (_, index) =>
    invoice({ id: `invoice-${index}`, number: `FV${index}` }),
  );
  const { service } = setup(documents);
  const result = await service.query('company-a', {
    ...query,
    view: 'detail',
    page: '100',
    pageSize: '10',
  });
  expect(result).toMatchObject({ total: 25, page: 3, pageSize: 10 });
  expect(result.items).toHaveLength(5);
  expect(result.totals[0]).toMatchObject({ invoiceCount: 25, total: 2975 });
});

it('exporta todas las páginas, consolidados y totales con valores numéricos', async () => {
  const { service } = setup(
    Array.from({ length: 25 }, (_, index) =>
      invoice({ id: `invoice-${index}`, number: `FV${index}` }),
    ),
  );
  const result = await service.export('company-a', {
    ...query,
    page: '2',
    pageSize: '10',
  });
  const workbook = new Workbook();
  await workbook.xlsx.load(result.buffer as never);
  expect(workbook.getWorksheet('Registros')!.rowCount).toBe(26);
  expect(workbook.getWorksheet('Consolidado')!.rowCount).toBe(2);
  expect(workbook.getWorksheet('Totales')!.getRow(2).values).toContain(2975);
  expect(
    workbook.getWorksheet('Filtros y criterios')!.rowCount,
  ).toBeGreaterThan(5);
  expect(result.filename).toBe('JARVIS-sales-2026-10-01-2026-10-31.xlsx');
}, 30000);

it('toma la empresa del usuario autenticado y no de parámetros enviados por el cliente', async () => {
  const reports = { query: jest.fn().mockResolvedValue({ items: [] }) };
  const controller = new JarvisReportsController(reports as never);
  const maliciousQuery = { ...query, companyId: 'company-b' };
  await controller.query(
    { userId: 'user-a', email: 'a@example.com', companyId: 'company-a' },
    maliciousQuery,
  );
  expect(reports.query).toHaveBeenCalledWith('company-a', maliciousQuery);
  expect(() =>
    controller.query(
      { userId: 'user-a', email: 'a@example.com', companyId: null },
      query,
    ),
  ).toThrow();
});

it('aplica la busqueda de ventas antes de paginar y parametriza el texto', async () => {
  const { service, source } = setup();
  const search = "FV1' OR 1=1";
  const result = await service.query('company', { ...query, report: 'sales', view: 'detail', search });
  expect(result.filters.search).toBe(search);
  const [sql, params] = source.query.mock.calls[0];
  expect(sql).toContain("concat_ws(' ', i.customer_identification, i.customer_name, i.prefix || i.number)");
  expect(sql).not.toContain(search);
  expect(params).toContain(search);
  expect(sql).toContain(`lower($${params.indexOf(search) + 1})`);
  expect(sql).toContain("i.prefix || '-' ||");
  expect(sql).toContain('END AS number, i.prefix');
});

it('devuelve el prefijo como metadato sin modificar el número oficial ni el Excel', async () => {
  const { service } = setup([invoice({ prefix: 'FV', number: 'FV001' })]);
  const selected = { ...query, report: 'sales', view: 'detail' };
  const result = await service.query('company', selected);
  expect(result.items[0]).toMatchObject({ number: 'FV001', prefix: 'FV' });
  const exported = await service.export('company', selected);
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  expect(workbook.getWorksheet('Registros')!.getRow(2).values).toContain('FV001');
  expect(workbook.getWorksheet('Registros')!.getRow(2).values).not.toContain('FV-001');
});

it('valida y recorta la busqueda general del reporte', () => {
  expect(filters({ search: '  FV1  ' }).search).toBe('FV1');
  expect(() => filters({ search: 'x'.repeat(201) })).toThrow();
});


it.each(['iva', 'otherTaxes', 'retefuente', 'reteIca', 'reteIva'])('filtra comprobantes por %s antes de consolidar y totalizar', tax => {
  const selected = invoice({ id: 'selected', kind: 'CREDIT_NOTE' });
  const charge = tax === 'iva' || tax === 'reteIva' ? 19 : tax === 'otherTaxes' ? 8 : 0;
  selected.source!.items[0].taxAmount = charge;
  selected.source!.items[0].taxId = tax === 'otherTaxes' ? 4 : 1;
  selected.total = String(100 + charge);
  const retention = tax === 'retefuente' ? { id: 6, type: 'ReteRenta', percentage: 2 }
    : tax === 'reteIca' ? { id: 7, type: 'ReteICA', percentage: 10 }
    : tax === 'reteIva' ? { id: 5, type: 'ReteIVA', percentage: 15 } : null;
  if (retention) selected.source!.retentions = [retention];
  const plain = invoice({ id: 'plain', total: '100' });
  plain.source!.items[0].taxAmount = 0;
  const result = calculateJarvisReport([selected, plain, invoice({ id: 'legacy', source: null })], filters({ report: 'taxes', tax }));
  expect(result.detail).toHaveLength(1);
  expect(result.detail[0].id).toBe('selected');
  expect(Number(result.detail[0][tax])).toBeLessThan(0);
  expect(result.summary).toHaveLength(1);
  expect(result.totals[0].total).toBe(-Number(selected.total));
});

it('valida el impuesto y elimina el filtro de producto del reporte fiscal', () => {
  expect(filters({ report: 'taxes', tax: 'iva', product: 'producto anterior' })).toMatchObject({ tax: 'iva', product: '' });
  expect(() => filters({ report: 'taxes', tax: 'inventado' })).toThrow('impuesto');
  expect(() => filters({ report: 'sales', tax: 'iva' })).toThrow('impuesto');
});

it('exporta una sola hoja con los comprobantes filtrados, totales y datos de la empresa', async () => {
  const plain = invoice({ id: 'plain', number: 'FV2', total: '100' });
  plain.source!.items[0].taxAmount = 0;
  const { service } = setup([invoice(), plain]);
  const selected = { ...query, report: 'taxes', tax: 'iva', view: 'detail', page: '99', pageSize: '10' };
  const result = await service.query('company-a', selected);
  expect(result).toMatchObject({ total: 1, page: 1 });
  expect(result.items[0].id).toBe('invoice-1');
  expect(result.totals[0].iva).toBe(19);
  const exported = await service.export('company-a', selected);
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  expect(workbook.worksheets).toHaveLength(1);
  const sheet = workbook.getWorksheet('Impuestos detallados')!;
  expect(sheet.getCell('A2').value).toBe('Informe impuestos detallados');
  expect(sheet.getCell('A3').value).toBe('Empresa SAS');
  expect(sheet.getCell('A4').value).toBe('900123456');
  expect(sheet.getCell('A6').value).toContain('Impuesto: IVA');
  const columns = sheet.getRow(8).values as string[];
  const invoiceNumberColumn = columns.indexOf('Número de comprobante');
  const ivaColumn = columns.indexOf('IVA');
  expect(sheet.getRow(9).getCell(ivaColumn).value).toBe(19);
  expect(sheet.getRow(10).getCell(invoiceNumberColumn).value).toBe('FV1');
  expect(sheet.getRow(10).getCell(ivaColumn).value).toBe(19);
  expect(sheet.getCell('A11').value).not.toBe('FV2');
}, 30000);

it('exporta todos los registros fiscales, preserva monedas y no altera el número oficial', async () => {
  const documents = Array.from({ length: 25 }, (_, index) =>
    invoice({ id: String(index), prefix: 'FV', number: `FV${index}`, currency: index === 0 ? 'USD' : 'COP' }),
  );
  const { service, source } = setup(documents);
  const exported = await service.export('company-a', { ...query, report: 'taxes', view: 'detail', page: '2', pageSize: '10' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  const sheet = workbook.worksheets[0];
  expect(workbook.worksheets).toHaveLength(1);
  expect(sheet.getCell('A9').value).toBe('Total · USD');
  expect(sheet.getCell('A10').value).toBe('Total · COP');
  const numberColumn = (sheet.getRow(8).values as string[]).indexOf('Número de comprobante');
  expect(sheet.getRow(11).getCell(numberColumn).value).toBe('FV0');
  expect(sheet.getRow(35).getCell(numberColumn).value).toBe('FV24');
  expect(source.query).toHaveBeenCalledWith('SELECT name, nit FROM companies WHERE id=$1', ['company-a']);
});

it('indica las limitaciones fiscales en la misma hoja cuando no hay desglose', async () => {
  const { service } = setup([invoice({ source: null })]);
  const exported = await service.export('company-a', { ...query, report: 'taxes', view: 'detail' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  const sheet = workbook.worksheets[0];
  const values: string[] = [];
  sheet.eachRow(row => { if (typeof row.getCell(1).value === 'string') values.push(String(row.getCell(1).value)); });
  expect(values.some(value => value.includes('no conservan desglose suficiente'))).toBe(true);
  const columns = sheet.getRow(8).values as string[];
  expect(sheet.getRow(10).getCell(columns.indexOf('IVA')).value).toBeNull();
});

it('genera una hoja válida aun cuando no existen resultados', async () => {
  const { service } = setup();
  const exported = await service.export('company-a', { ...query, report: 'taxes', view: 'detail' });
  const workbook = new Workbook();
  await workbook.xlsx.load(exported.buffer as never);
  expect(workbook.worksheets).toHaveLength(1);
  expect(workbook.worksheets[0].getCell('A8').value).toBe('Fecha de emisión');
  expect(workbook.worksheets[0].getCell('A9').value).toBeNull();
});

it('rechaza el exceso de filas en vez de crear hojas adicionales o truncar datos', () => {
  expect(() => addTaxDetailSheet(
    new Workbook(), { name: 'Empresa', nit: '1' }, filters({ report: 'taxes', view: 'detail' }),
    [{ key: 'number', label: 'Número', format: 'text' }], new Array(1048576), [], [],
  )).toThrow('límite de filas');
});

it('informa si la empresa del reporte ya no existe', async () => {
  const { service, source } = setup();
  source.query.mockResolvedValue([]);
  await expect(service.export('company-a', { ...query, report: 'taxes', view: 'detail' })).rejects.toThrow('No se encontró la empresa');
});
