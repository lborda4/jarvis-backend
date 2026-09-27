import { applyItemClassificationToPayload } from './electronic-document-account-mapping.helper';
import {
  resolveItemAiSuggestion,
  summarizeDocumentAiSuggestion,
} from './electronic-document-ai-suggestion.helper';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

const item = {
  descripcion: 'Servicio',
  cantidad: 1,
  valorUnitario: 100,
  total: 100,
};
const classified = {
  accountCode: '5135',
  accountName: 'Servicios',
  productCode: null,
  productName: null,
  confidence: 55,
};
const classification = {
  ...classified,
  itemType: 'Account' as const,
  items: [classified],
};

describe('item AI suggestion storage', () => {
  it('stores one suggestion per item without copying it to accountMapping or the root', () => {
    const payload = applyItemClassificationToPayload(
      {
        items: [item],
        aiSuggestion: { account: { code: 'old', name: 'Old' }, retentions: [] },
      } as ElectronicDocumentPayload,
      classification,
    );
    expect(payload).not.toHaveProperty('aiSuggestion');
    expect(payload.items[0]).not.toHaveProperty('accountMapping');
    expect(payload.items[0].aiSuggestion).toEqual({
      account: { code: '5135', name: 'Servicios' },
      product: null,
      confidence: 55,
    });
    expect(summarizeDocumentAiSuggestion(payload)?.confidence).toBe(55);
  });

  it('preserves a manually assigned account independently of the AI suggestion', () => {
    const mapping = { code: '5195', description: 'Manual' };
    const payload = applyItemClassificationToPayload(
      {
        items: [{ ...item, accountMapping: mapping }],
      } as ElectronicDocumentPayload,
      classification,
    );
    expect(payload.items[0].accountMapping).toEqual(mapping);
    expect(payload.items[0].aiSuggestion?.account?.code).toBe('5135');
  });

  it('derives minimum confidence and no document account for differing lines', () => {
    const payload = applyItemClassificationToPayload(
      { items: [item, item] } as ElectronicDocumentPayload,
      {
        ...classification,
        items: [
          classified,
          { ...classified, accountCode: '5195', confidence: 80 },
        ],
      },
    );
    expect(summarizeDocumentAiSuggestion(payload)).toMatchObject({
      account: null,
      confidence: 55,
      itemType: 'Account',
    });
  });

  it('records failed lines with zero confidence and does not reuse an old root suggestion', () => {
    const payload = applyItemClassificationToPayload(
      { items: [item, item] } as ElectronicDocumentPayload,
      classification,
    );
    expect(payload.items[1].aiSuggestion).toEqual({
      account: null,
      product: null,
      confidence: 0,
    });
    expect(summarizeDocumentAiSuggestion(payload)?.confidence).toBe(0);
  });

  it('reads legacy suggestions while respecting an explicit per-item null', () => {
    const legacy = {
      account: { code: '5135', name: 'Servicios' },
      confidence: 80,
      retentions: [],
    };
    const payload = {
      items: [item],
      aiSuggestion: legacy,
    } as ElectronicDocumentPayload;
    expect(resolveItemAiSuggestion(payload, 0)).toEqual(legacy);
    payload.items = [{ ...item, aiSuggestion: null }];
    expect(resolveItemAiSuggestion(payload, 0)).toBeNull();
    expect(summarizeDocumentAiSuggestion(payload)?.account).toBeNull();
  });
});

it('preserves previously resolved lines when a recovery attempt returns no code', () => {
  const previous = {
    account: { code: '5135', name: 'Servicios' },
    product: null,
    confidence: 85,
  };
  const payload = applyItemClassificationToPayload(
    {
      items: [{ ...item, aiSuggestion: previous }],
    } as ElectronicDocumentPayload,
    { ...classification, items: [] },
  );
  expect(payload.items[0].aiSuggestion).toEqual(previous);
});
