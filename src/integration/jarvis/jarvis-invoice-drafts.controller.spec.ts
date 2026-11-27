import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { JarvisInvoiceDraftsController } from './jarvis-invoice-drafts.controller';
const user = { companyId: 'company-1' } as AuthenticatedUser;
function setup() {
  const query = jest.fn().mockResolvedValue([{ id: 'draft-1' }]);
  return { query, controller: new JarvisInvoiceDraftsController({ query } as never) };
}
it('persists incomplete drafts without requiring an invoice sender', async () => {
  const { controller, query } = setup();
  const state = { selectedCustomer: null, lines: [], notes: 'Pendiente' };
  expect(await controller.save(user, 'draft-1', { documentKind: 'ELECTRONIC_INVOICE', state })).toEqual({ draft: { id: 'draft-1' } });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jarvis_invoice_drafts'), ['draft-1', 'company-1', 'ELECTRONIC_INVOICE', JSON.stringify(state)]);
  expect(query).toHaveBeenCalledTimes(1);
});
it('conserva una orden de compra parcial al guardar y volver a abrir el borrador', async () => {
  const { controller, query } = setup();
  const purchaseOrder = { prefix: 'OC-', consecutive: '00123', issueDate: '' };
  await controller.save(user, 'draft-1', { documentKind: 'ELECTRONIC_INVOICE', state: { purchaseOrder } });
  const storedState = JSON.parse(query.mock.calls[0][1][3]);
  query.mockResolvedValue([{ state: storedState }]);
  expect(await controller.get(user, 'draft-1')).toEqual({ draft: { state: { purchaseOrder } } });
});
it('scopes reads and deletes to the authenticated company', async () => {
  const { controller, query } = setup();
  await controller.get(user, 'draft-1');
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('company_id=$2'), ['draft-1', 'company-1']);
  await controller.remove(user, 'draft-1');
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('company_id=$2'), ['draft-1', 'company-1']);
});
it('does not expose a draft from another company', async () => {
  const { controller, query } = setup();
  query.mockResolvedValue([]);
  await expect(controller.get(user, 'draft-1')).rejects.toBeInstanceOf(NotFoundException);
});
it('does not overwrite another company or document type on a colliding id', async () => {
  const { controller, query } = setup();
  query.mockResolvedValue([]);
  await expect(controller.save(user, 'draft-1', { documentKind: 'ELECTRONIC_INVOICE', state: {} })).rejects.toBeInstanceOf(NotFoundException);
  expect(query.mock.calls[0][0]).toContain('jarvis_invoice_drafts.company_id=EXCLUDED.company_id');
  expect(query.mock.calls[0][0]).toContain('jarvis_invoice_drafts.document_kind=EXCLUDED.document_kind');
});
it('rejects invalid kinds and oversized forms without writing', async () => {
  const { controller, query } = setup();
  await expect(controller.save(user, 'draft-1', { documentKind: 'INVALID', state: {} })).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.save(user, 'draft-1', { documentKind: 'ELECTRONIC_INVOICE', state: { notes: 'x'.repeat(1024 * 1024) } })).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
});
it('protege el archivo binario al volver a guardar los campos del borrador', async () => {
  const { controller, query } = setup();
  await controller.save(user, 'draft-1', { documentKind: 'ELECTRONIC_INVOICE', state: { notes: 'Cambios', attachment: { name: 'cliente.pdf' }, __attachment: { dataBase64: 'no permitido' } } });
  expect(query.mock.calls[0][0]).toContain("jarvis_invoice_drafts.state->'__attachment'");
  expect(JSON.parse(query.mock.calls[0][1][3])).toEqual({ notes: 'Cambios' });
});
it('devuelve solo los metadatos para reabrir un archivo guardado', async () => {
  const { controller, query } = setup();
  const attachment = { name: 'soporte.pdf', mimeType: 'application/pdf', size: 123 };
  query.mockResolvedValue([{ state: { notes: 'Original' }, attachment }]);
  expect(await controller.get(user, 'draft-1')).toEqual({ draft: { state: { notes: 'Original', attachment } } });
  expect(query.mock.calls[0][0]).toContain("- 'dataBase64'");
});

it('reserva atómicamente el borrador de ventas sin sobrescribir cambios ni envíos previos', async () => {
  const { controller, query } = setup();
  const state = { importSource: 'sales-excel-v1', importReference: 'A', lines: [] };
  const result = await controller.claimSalesImport(user, 'draft-1', { state });
  expect(result.token).toMatch(/^[a-f0-9-]{36}$/);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("NOT state ? 'importDelivery'"), ['draft-1', 'company-1', JSON.stringify(state), result.token]);
  expect(query.mock.calls[0][0]).toContain("state - '__attachment'=$3::jsonb");
  expect(query.mock.calls[0][0]).toContain('SELECT id FROM claimed');
  expect(query.mock.calls[0][0]).toContain("document_kind='ELECTRONIC_INVOICE'");
  query.mockResolvedValue([]);
  await expect(controller.claimSalesImport(user, 'draft-1', { state })).rejects.toBeInstanceOf(ConflictException);
});

it('confirma solo el intento reservado en la empresa y protege su estado y eliminación', async () => {
  const { controller, query } = setup();
  const token = '12345678-1234-4234-8234-123456789abc';
  await controller.completeSalesImport(user, 'draft-1', { token, invoiceId: 'history-id' });
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("state->'importDelivery'->>'claimToken'=$3"), ['draft-1', 'company-1', token, 'history-id']);
  expect(query.mock.calls[0][0]).toContain('SELECT id FROM completed');
  await controller.save(user, 'draft-1', { documentKind: 'ELECTRONIC_INVOICE', state: {} });
  expect(query.mock.calls[1][0]).toContain("jarvis_invoice_drafts.state ? 'importDelivery'");
  await controller.remove(user, 'draft-1');
  expect(query.mock.calls[2][0]).toContain("state ? 'importDelivery'");
  expect(query.mock.calls[2][0]).toContain('SELECT id FROM deleted');
  query.mockResolvedValue([]);
  await expect(controller.completeSalesImport(user, 'draft-1', { token })).rejects.toBeInstanceOf(ConflictException);
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'draft-1' }]);
  await expect(controller.remove(user, 'draft-1')).rejects.toBeInstanceOf(ConflictException);
  query.mockResolvedValue([]);
  await expect(controller.remove(user, 'missing')).resolves.toEqual({ deleted: true });
});
