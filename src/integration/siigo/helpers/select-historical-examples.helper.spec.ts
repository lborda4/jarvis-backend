import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import {
  MAX_HISTORICAL_EXAMPLES_PER_INVOICE,
  selectHistoricalExamplesForPrompt,
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
  it('de una factura con muchas líneas solo manda las comparables con el ítem actual', () => {
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

    expect(selected.map((example) => example.descripcionItem)).toEqual([
      'Resma de papel oficio',
    ]);
  });

  it('elige la compra reciente comparable y descarta una corrección antigua de otro concepto', () => {
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
    ]);
  });

  it('no manda ejemplos si ninguno se parece a la descripción actual', () => {
    const selected = selectHistoricalExamplesForPrompt(
      ['PONY MALTA GO PET 20'],
      [
        row({ descripcionItem: 'Tela ripstop 160' }),
        row({ descripcionItem: 'Hilo de coser negro' }),
      ],
    );

    expect(selected).toEqual([]);
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
