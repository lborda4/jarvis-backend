import { HistorialFacturaFuente } from '../../enums/historial-factura-fuente.enum';
import {
  ACCOUNT_CONFIDENCE,
  resolveAccountSuggestionConfidence,
} from './account-suggestion-confidence.helper';

describe('resolveAccountSuggestionConfidence', () => {
  it('descripción exacta confirmada por el contador: alta', () => {
    expect(
      resolveAccountSuggestionConfidence({
        itemDescription: 'Servicio de aseo mensual',
        accountCode: '51050601',
        historicalRows: [
          {
            descripcionItem: 'Servicio de aseo mensual',
            cuentaPuc: '51050601',
            fuente: HistorialFacturaFuente.CORREGIDO_CONTADOR,
          },
        ],
      }),
    ).toBe(ACCOUNT_CONFIDENCE.EXACT_CONFIRMED);
  });

  it('factura anterior similar: media/alta', () => {
    expect(
      resolveAccountSuggestionConfidence({
        itemDescription: 'Servicio de aseo',
        accountCode: '51050601',
        historicalRows: [
          {
            descripcionItem: 'Servicio de aseo mensual',
            cuentaPuc: '51050601',
            fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
          },
        ],
      }),
    ).toBe(ACCOUNT_CONFIDENCE.SIMILAR_INVOICE);
  });

  it('solo balance por tercero: media', () => {
    expect(
      resolveAccountSuggestionConfidence({
        itemDescription: 'Servicio de aseo',
        accountCode: '51050601',
        historicalRows: [
          {
            descripcionItem: 'Referencia de balance por tercero',
            cuentaPuc: '51050601',
            fuente: HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
          },
        ],
      }),
    ).toBe(ACCOUNT_CONFIDENCE.BALANCE_THIRD_PARTY);
  });

  it('sin historial del código: catálogo general, baja', () => {
    expect(
      resolveAccountSuggestionConfidence({
        itemDescription: 'Servicio de aseo',
        accountCode: '51959501',
        historicalRows: [
          {
            descripcionItem: 'Servicio de aseo mensual',
            cuentaPuc: '51050601',
            fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
          },
        ],
      }),
    ).toBe(ACCOUNT_CONFIDENCE.CATALOG);
  });

  it('si hay factura similar y balance para el mismo código, gana la factura', () => {
    expect(
      resolveAccountSuggestionConfidence({
        itemDescription: 'Servicio de aseo',
        accountCode: '51050601',
        historicalRows: [
          {
            descripcionItem: 'Referencia de balance por tercero',
            cuentaPuc: '51050601',
            fuente: HistorialFacturaFuente.SIIGO_BALANCE_TERCERO,
          },
          {
            descripcionItem: 'Servicio de aseo mensual',
            cuentaPuc: '51050601',
            fuente: HistorialFacturaFuente.SIIGO_ORIGINAL,
          },
        ],
      }),
    ).toBe(ACCOUNT_CONFIDENCE.SIMILAR_INVOICE);
  });
});
