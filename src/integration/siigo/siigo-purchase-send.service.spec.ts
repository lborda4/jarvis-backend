import { BadRequestException } from '@nestjs/common';
import { SiigoPurchaseSendService } from './siigo-purchase-send.service';
import { ElectronicDocumentType } from '../../electronic-document/enums/electronic-document-type.enum';
import { CreateSiigoPurchaseSendRequestDto } from './dto/create-siigo-purchase-send.dto';

jest.mock('./helpers/siigo-support-document-preference.helper', () => ({
  buildSupplierPreferenceSnapshotFromSendRequest: jest.fn(() => null),
  persistSupplierPreferencesFromSendRequest: jest.fn(),
  persistHistorialFacturaFromSendRequest: jest.fn(),
}));
jest.mock('./helpers/siigo-context.helper', () => ({ getSiigoIntegration: jest.fn(async () => ({ id: 'integration-1' })) }));

describe('Envío de compra: los precios del formulario son base sin IVA', () => {
  it.each([244437, 332436.96])('conserva precios aunque el subtotal DIAN sea %s y existan líneas exentas', async (subtotal) => {
    const document = { electronicDocumentType: ElectronicDocumentType.PURCHASE_INVOICE, payload: { totals: { subtotal, total: 378880 } } };
    const service = new SiigoPurchaseSendService(
      { updateStatus: jest.fn(), requireById: jest.fn(async () => document), runExclusiveForDocumentCreation: jest.fn(async (_id, _company, callback) => callback()) } as never,
      {} as never,
      { getPurchaseConfig: jest.fn(async () => ({ documentId: 1 })), getPurchaseDocumentTypeId: jest.fn(async () => 1) } as never,
      {} as never,
      { listTaxes: jest.fn(async () => [{ id: 19, type: 'IVA', percentage: 19, active: true }]) } as never,
      { listAccounts: jest.fn(async () => [{ code: '51451001', name: 'Gastos' }]) } as never,
      {} as never, {} as never,
      { assertCanCreateDocuments: jest.fn(), withSiigoQuotaLock: jest.fn((_company, work) => work()) } as never,
      {} as never, {} as never,
    );
    // Stop at the external boundary: the test must never issue a real purchase.
    const send = jest.spyOn(service as any, 'createPurchaseInSiigo').mockRejectedValue(new BadRequestException('test boundary'));
    const prices = [1015, 3500, 20000, 9100, 46218.48, 88000, 8000];
    const quantities = [20, 5, 4, 2, 2, 1, 2];
    const request: CreateSiigoPurchaseSendRequestDto = {
      documentId: 'doc-mixed', date: '2026-09-24', supplier: { identification: '900321769' },
      provider_invoice: { prefix: 'IND', number: '24539' },
      items: prices.map((price, index) => ({ code: '51451001', quantity: quantities[index], price, ...(index === 5 ? {} : { taxes: [{ id: 19 }] }) })),
      payments: [{ id: 1, value: 378880 }],
    };
    const before = JSON.parse(JSON.stringify(request));
    await expect(service.sendPurchase(request, 'company-1')).rejects.toThrow('test boundary');
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][1] as any;
    expect(payload.items.map((item: any) => item.price)).toEqual(prices);
    expect(payload.items[5].taxes ?? []).toEqual([]);
    expect(payload.items[0].taxes).toEqual([{ id: 19 }]);
    expect(payload.payments[0].value).toBe(378880);
    expect(request).toEqual(before);
  });
});
