import {
  applyAiClassificationToPayloadItems,
  applyItemClassificationToPayload,
} from './electronic-document-account-mapping.helper';
import { ElectronicDocumentItem } from '../interfaces/electronic-document-item.interface';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

function buildItem(
  descripcion: string,
  overrides: Partial<ElectronicDocumentItem> = {},
): ElectronicDocumentItem {
  return {
    descripcion,
    cantidad: 1,
    valorUnitario: 1000,
    total: 1000,
    ...overrides,
  };
}

describe('applyAiClassificationToPayloadItems', () => {
  it('escribe accountMapping e itemType en cada línea, no una sola cuenta para toda la factura', () => {
    const items = applyAiClassificationToPayloadItems(
      [
        buildItem('Resma de papel'),
        buildItem('Jabón líquido'),
        buildItem('Mantenimiento aires'),
      ],
      {
        itemType: 'Account',
        items: [
          { accountCode: '51953001', accountName: 'Papelería' },
          { accountCode: '51050601', accountName: 'Aseo' },
          { accountCode: '51400501', accountName: 'Mantenimiento' },
        ],
      },
    );

    expect(items.map((item) => item.accountMapping?.code)).toEqual([
      '51953001',
      '51050601',
      '51400501',
    ]);
    expect(items.every((item) => item.itemType === 'Account')).toBe(true);
  });

  it('no pisa un accountMapping que el contador ya había guardado', () => {
    const [item] = applyAiClassificationToPayloadItems(
      [
        buildItem('Resma de papel', {
          accountMapping: { code: '51010101', description: 'Elegida a mano' },
        }),
      ],
      {
        itemType: 'Account',
        items: [{ accountCode: '51953001', accountName: 'Papelería' }],
      },
    );

    expect(item.accountMapping).toEqual({
      code: '51010101',
      description: 'Elegida a mano',
    });
  });
});

describe('applyItemClassificationToPayload', () => {
  it('escribe accountMapping por línea y el snapshot de aiSuggestion', () => {
    const payload = applyItemClassificationToPayload(
      {
        items: [buildItem('Resma de papel'), buildItem('Jabón líquido')],
      } as ElectronicDocumentPayload,
      {
        itemType: 'Account',
        accountCode: null,
        accountName: null,
        productCode: null,
        productName: null,
        confidence: 70,
        items: [
          {
            accountCode: '51953001',
            accountName: 'Papelería',
            productCode: null,
            productName: null,
            confidence: 80,
          },
          {
            accountCode: '51050601',
            accountName: 'Aseo',
            productCode: null,
            productName: null,
            confidence: 70,
          },
        ],
      },
    );

    expect(payload.items.map((item) => item.accountMapping?.code)).toEqual([
      '51953001',
      '51050601',
    ]);
    expect(
      payload.items.map((item) => item.aiSuggestion?.account?.code),
    ).toEqual(['51953001', '51050601']);
    expect(payload.aiSuggestion).not.toHaveProperty('items');
    expect(payload.items.map((item) => item.aiSuggestion?.confidence)).toEqual([
      80, 70,
    ]);
    expect(payload.aiSuggestion?.confidence).toBe(70);
  });

  it('persiste confidence=0 si no hay cuenta ni producto, aunque classification.confidence sea null', () => {
    const payload = applyItemClassificationToPayload(
      { items: [buildItem('Ítem nuevo')] } as ElectronicDocumentPayload,
      {
        itemType: 'Account',
        accountCode: null,
        accountName: null,
        productCode: null,
        productName: null,
        confidence: null,
        items: [
          {
            accountCode: null,
            accountName: null,
            productCode: null,
            productName: null,
            confidence: null,
          },
        ],
      },
    );

    expect(payload.aiSuggestion?.confidence).toBe(0);
  });

  it('persiste confidence=0 si el modelo no mandó confidence, aunque sí haya código', () => {
    const payload = applyItemClassificationToPayload(
      { items: [buildItem('Resma de papel')] } as ElectronicDocumentPayload,
      {
        itemType: 'Account',
        accountCode: '51953001',
        accountName: 'Papelería',
        productCode: null,
        productName: null,
        confidence: null,
        items: [
          {
            accountCode: '51953001',
            accountName: 'Papelería',
            productCode: null,
            productName: null,
            confidence: null,
          },
        ],
      },
    );

    expect(payload.aiSuggestion?.account?.code).toBe('51953001');
    expect(payload.aiSuggestion?.confidence).toBe(0);
  });
});
