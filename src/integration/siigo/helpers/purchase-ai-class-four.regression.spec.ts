import { buildAccountCodeClassificationPrompt, parseAccountCodeClassificationResponse, parseProductCodeClassificationResponse } from './purchase-item-classification-prompt.helper';

describe('Compras SIIGO: prohibición de cuentas clase 4', () => {
  it.each([false, true])('excluye clase 4 del catálogo y contexto, con historial=%s', (history) => {
    const messages = buildAccountCodeClassificationPrompt({
      supplierName: 'Proveedor nuevo', ourCompanyName: 'Empresa',
      items: [{ itemId: 'i1', descripcion: 'Servicio' }],
      accounts: [{ code: ' 413505 ', name: 'Ingresos prohibidos' }, { code: '513505', name: 'Gastos válidos' }],
      historicalExamples: history ? [{ descripcionItem: 'Servicio', cuentaPuc: '413505' }] : [],
      supplierUsedAccounts: history ? [{ code: '413505', name: 'Ingresos prohibidos' }] : [],
    });
    expect(messages[1].content).not.toContain('413505');
    expect(messages[1].content).not.toContain('Ingresos prohibidos');
    expect(messages[1].content).toContain('513505');
    expect(messages[0].content).toContain('Regla adicional: En facturas de compra no recomiendes cuentas contables de clase 4');
  });
  it('descarta la respuesta prohibida sin reemplazarla por una cuenta inventada', () => {
    const result = parseAccountCodeClassificationResponse(JSON.stringify({ items: [
      { itemId: 'i1', accountCode: ' 413505 ', confidence: 99 },
      { itemId: 'i2', accountCode: '61600502', confidence: 95 },
    ] }), ['i1', 'i2']);
    expect(result.items).toEqual([{ accountCode: null, confidence: null }, { accountCode: '61600502', confidence: 95 }]);
  });
  it('no confunde códigos de producto que empiezan por 4 con cuentas contables', () => {
    const result = parseProductCodeClassificationResponse(JSON.stringify({ items: [
      { itemId: 'i1', productCode: '413505', confidence: 95 },
    ] }), ['i1']);
    expect(result.items[0].productCode).toBe('413505');
  });
});
