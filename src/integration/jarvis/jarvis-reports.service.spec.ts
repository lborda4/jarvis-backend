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
      .fn<Promise<ReportDocument[]>, [string, unknown[]]>()
      .mockResolvedValue(documents),
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
});

it('valida y recorta la busqueda general del reporte', () => {
  expect(filters({ search: '  FV1  ' }).search).toBe('FV1');
  expect(() => filters({ search: 'x'.repeat(201) })).toThrow();
});
