import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import {
  MAX_HISTORICAL_EXAMPLES_PER_INVOICE,
  selectHistoricalExamplesForPrompt,
  splitSupplierHistory,
  uniqueSupplierUsedAccounts,
} from './select-historical-examples.helper';

function row(overrides: {
  descripcionItem: string;
  facturaId?: string;
  fechaFactura?: string;
  fuente?: HistorialFacturaFuente;
}) {
  return {
    facturaId: 'fac-1',
    fechaFactura: '2026-01-01',
    fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
    ...overrides,
  };
}

describe('selectHistoricalExamplesForPrompt', () => {
  it('prioriza las líneas comparables y completa el cupo con el resto de la factura del proveedor', () => {
    const selected = selectHistoricalExamplesForPrompt(
      ['Resma de papel tamaño carta'],
      [
        row({ descripcionItem: 'Tela ripstop 160', facturaId: 'fac-gorda' }),
        row({ descripcionItem: 'Hilo de coser negro', facturaId: 'fac-gorda' }),
        row({
          descripcionItem: 'Resma de papel oficio',
          facturaId: 'fac-gorda',
        }),
        row({ descripcionItem: 'Botón metálico 15mm', facturaId: 'fac-gorda' }),
      ],
    );

    expect(selected[0].descripcionItem).toBe('Resma de papel oficio');
    expect(selected).toHaveLength(MAX_HISTORICAL_EXAMPLES_PER_INVOICE);
  });

  it('pone primero la compra reciente comparable y después el resto del histórico del proveedor', () => {
    const selected = selectHistoricalExamplesForPrompt(
      ['Galleta MUUU leche C'],
      [
        row({
          descripcionItem: 'Tela ripstop 160',
          facturaId: 'fac-vieja',
          fechaFactura: '2023-01-01',
          fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
        }),
        row({
          descripcionItem: 'Galleta de leche surtida',
          facturaId: 'fac-nueva',
          fechaFactura: '2026-09-01',
        }),
      ],
    );

    expect(selected.map((example) => example.descripcionItem)).toEqual([
      'Galleta de leche surtida',
      'Tela ripstop 160',
    ]);
  });

  it('si ninguno se parece, igual manda las líneas recientes del proveedor', () => {
    const selected = selectHistoricalExamplesForPrompt(
      ['PONY MALTA GO PET 20'],
      [
        row({
          descripcionItem: 'Tela ripstop 160',
          fechaFactura: '2026-01-01',
        }),
        row({
          descripcionItem: 'Hilo de coser negro',
          fechaFactura: '2026-08-01',
        }),
      ],
    );

    expect(selected.map((example) => example.descripcionItem)).toEqual([
      'Hilo de coser negro',
      'Tela ripstop 160',
    ]);
  });

  it('a igualdad de concepto, prefiere la corrección del contador sobre la fila de SIIGO', () => {
    const selected = selectHistoricalExamplesForPrompt(
      ['Servicio de aseo mensual'],
      [
        row({
          descripcionItem: 'Servicio de aseo mensual',
          facturaId: 'fac-siigo',
          fechaFactura: '2026-09-01',
        }),
        row({
          descripcionItem: 'Servicio de aseo mensual',
          facturaId: 'fac-contador',
          fechaFactura: '2026-08-01',
          fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
        }),
      ],
    );

    expect(selected).toHaveLength(1);
    expect(selected[0].facturaId).toBe('fac-contador');
  });

  it('no deja que una sola factura ocupe más de MAX_HISTORICAL_EXAMPLES_PER_INVOICE cupos', () => {
    const fatInvoiceLines = Array.from(
      { length: 8 },
      (_, index) =>
        row({
          descripcionItem: `Servicio de aseo zona ${index + 1}`,
          facturaId: 'fac-gorda',
        }),
    );
    const otherInvoice = row({
      descripcionItem: 'Servicio de aseo oficinas',
      facturaId: 'fac-otra',
    });

    const selected = selectHistoricalExamplesForPrompt(
      ['Servicio de aseo mensual'],
      [...fatInvoiceLines, otherInvoice],
    );

    const fromFat = selected.filter(
      (example) => example.facturaId === 'fac-gorda',
    );
    expect(fromFat.length).toBe(MAX_HISTORICAL_EXAMPLES_PER_INVOICE);
    expect(selected.some((example) => example.facturaId === 'fac-otra')).toBe(
      true,
    );
  });
});

describe('splitSupplierHistory', () => {
  it('separa facturas con descripción del balance general', () => {
    const { invoiceRows, balanceRows } = splitSupplierHistory([
      row({
        descripcionItem: 'Resma de papel',
        fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
      }),
      row({
        descripcionItem: 'Referencia de balance por tercero',
        fuente: HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
      }),
    ]);

    expect(invoiceRows).toHaveLength(1);
    expect(invoiceRows[0].descripcionItem).toBe('Resma de papel');
    expect(balanceRows).toHaveLength(1);
    expect(balanceRows[0].fuente).toBe(
      HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
    );
  });
});

describe('uniqueSupplierUsedAccounts', () => {
  it('lista cada cuenta distinta del proveedor con el nombre del catálogo', () => {
    expect(
      uniqueSupplierUsedAccounts(
        [
          { cuentaPuc: '51356002' },
          { cuentaPuc: '51953001' },
          { cuentaPuc: '51356002' },
        ],
        [
          { code: '51356002', name: 'Servicio Linea Telefonica' },
          { code: '51953001', name: 'Papelería' },
        ],
      ),
    ).toEqual([
      { code: '51356002', name: 'Servicio Linea Telefonica' },
      { code: '51953001', name: 'Papelería' },
    ]);
  });
});
