import { addAiRequestCost } from './electronic-document-ai-cost.helper';
import { applyItemClassificationToPayload } from './electronic-document-account-mapping.helper';
import { summarizeDocumentAiSuggestion } from './electronic-document-ai-suggestion.helper';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

it('conserva los costos al reemplazar una sugerencia antigua con sugerencias por ítem', () => {
  const aiSuggestion = addAiRequestCost({
    account: { code: 'old', name: 'Antigua' }, retentions: [],
  }, 'req-1', 0.000000012345);
  const payload = applyItemClassificationToPayload({
    items: [{ descripcion: 'Servicio', cantidad: 1, valorUnitario: 100, total: 100 }],
    aiSuggestion,
  } as unknown as ElectronicDocumentPayload, {
    itemType: 'Account', accountCode: '5135', accountName: 'Servicios',
    productCode: null, productName: null, confidence: 90,
  });
  expect(payload.aiSuggestion?.costsByRequest).toEqual({ 'req-1': 0.000000012345 });
  expect(payload.aiSuggestion?.totalCost).toBe(0.000000012345);
  expect(payload.aiSuggestion?.account).toBeUndefined();
  expect(payload.items[0].aiSuggestion?.account?.code).toBe('5135');
});

it('registrar el costo no inventa una clasificación ni una confianza', () => {
  expect(summarizeDocumentAiSuggestion({
    items: [], aiSuggestion: addAiRequestCost(null, 'req-1', 0),
  })).toBeNull();
});
