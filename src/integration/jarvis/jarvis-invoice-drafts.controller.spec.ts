import { BadRequestException, NotFoundException } from '@nestjs/common';
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
