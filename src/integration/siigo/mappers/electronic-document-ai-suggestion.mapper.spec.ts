import { mapElectronicDocumentToSiigoPurchase } from './electronic-document-to-siigo-purchase.mapper';
import { mapElectronicDocumentToSiigoSupportDocument } from './electronic-document-to-siigo-support-document.mapper';
import { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';

const config = {
  documentId: 1,
  paymentTypeId: 1,
  defaultTaxId: 1,
  sendStamp: false,
};
const payload = (): ElectronicDocumentPayload => ({
  supplier: {
    documentNumber: '900123456',
    documentType: 'NIT',
    name: 'Proveedor',
  },
  invoice: {
    cufe: 'cufe',
    number: '100',
    issueDate: '2026-01-01',
    currency: 'COP',
  },
  items: [
    {
      descripcion: 'Servicio',
      cantidad: 1,
      valorUnitario: 1000,
      total: 1000,
      itemType: 'Account',
      aiSuggestion: {
        account: { code: '5135', name: 'Servicios' },
        confidence: 85,
      },
    },
  ],
  taxes: [],
  totals: { subtotal: 1000, iva: 0, total: 1000 },
});

describe.each([
  mapElectronicDocumentToSiigoPurchase,
  mapElectronicDocumentToSiigoSupportDocument,
])('sending item suggestions without duplicated mappings', (map) => {
  it('reads the account from the item suggestion', () => {
    expect(map(payload(), config).items[0].code).toBe('5135');
  });
  it('prioritizes a manually saved account', () => {
    const document = payload();
    document.items[0].accountMapping = { code: '5195' };
    expect(map(document, config).items[0].code).toBe('5195');
  });
  it('still rejects an item without an account', () => {
    const document = payload();
    document.items[0].aiSuggestion = null;
    expect(() => map(document, config)).toThrow();
  });
});
