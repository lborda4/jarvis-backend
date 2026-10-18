import { resolveInvoicePayments } from './jarvis-invoice-payments.helper';
import type { CreateJarvisInvoiceRequestDto } from '../dto/create-jarvis-invoice.dto';

const cash = { id: '11111111-1111-4111-8111-111111111111', name: 'Efectivo', nextpymeMethodId: 10, negotiation: 'CASH' as const };
const credit = { id: '22222222-2222-4222-8222-222222222222', name: 'Crédito clientes', nextpymeMethodId: 1, negotiation: 'CREDIT' as const };
function setup() {
  const source = { query: jest.fn().mockResolvedValue([cash, credit]) };
  const request: CreateJarvisInvoiceRequestDto = {
    issueDate: '2026-10-17', customerDocumentType: 'NIT', customerIdentification: '900123', items: [],
    payment: { id: 1, payment_form_id: 2, due_date: '2026-11-17' },
    paymentBreakdown: [
      { methodId: cash.id, methodName: 'ignorar', nextpymeMethodId: 999, negotiation: 'CREDIT', amount: 100 },
      { methodId: credit.id, methodName: credit.name, nextpymeMethodId: 1, negotiation: 'CREDIT', amount: 200 },
    ],
  };
  return { source, request };
}
it('guarda nombres y negociación del catálogo de la empresa sin confiar en el cliente', async () => {
  const { source, request } = setup();
  const result = await resolveInvoicePayments(source, 'company-1', request, 300);
  expect(source.query).toHaveBeenCalledWith(expect.stringContaining('company_id=$1'), ['company-1', [cash.id, credit.id]]);
  expect(result?.[0]).toEqual({ methodId: cash.id, methodName: cash.name, nextpymeMethodId: 10, negotiation: 'CASH', amount: 100 });
});
it('rechaza pagos de otra empresa', async () => {
  const { source, request } = setup();
  source.query.mockResolvedValue([cash]);
  await expect(resolveInvoicePayments(source, 'company-2', request, 300)).rejects.toThrow('no pertenece');
});
it('rechaza importes que no suman el total neto', async () => {
  const { source, request } = setup();
  await expect(resolveInvoicePayments(source, 'company', request, 299)).rejects.toThrow('total neto');
  expect(source.query).not.toHaveBeenCalled();
});
it.each([-1, 0, 1.001, NaN, Infinity])('rechaza el importe inválido %s', async amount => {
  const { source, request } = setup();
  request.paymentBreakdown![0].amount = amount;
  await expect(resolveInvoicePayments(source, 'company', request, 300)).rejects.toThrow('importe positivo');
});
it('exige crédito cuando existe un saldo pendiente aunque el primer pago sea efectivo', async () => {
  const { source, request } = setup();
  request.payment = { id: 10, payment_form_id: 1 };
  await expect(resolveInvoicePayments(source, 'company', request, 300)).rejects.toThrow('negociación');
});
it.each(['', '2026-10-01', '2026-02-30'])('exige un vencimiento válido para crédito: %s', async due => {
  const { source, request } = setup();
  request.payment!.due_date = due;
  await expect(resolveInvoicePayments(source, 'company', request, 300)).rejects.toThrow('vencimiento');
});
it('conserva compatibilidad con documentos sin desglose', async () => {
  const { source, request } = setup();
  delete request.paymentBreakdown;
  expect(await resolveInvoicePayments(source, 'company', request, 300)).toBeUndefined();
  expect(source.query).not.toHaveBeenCalled();
});
