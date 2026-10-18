import { NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { JarvisInvoiceAttachmentsController } from './jarvis-invoice-attachments.controller';
import { attachmentMetadata, loadDraftAttachment, MAX_INVOICE_ATTACHMENT_BYTES, readInvoiceAttachment } from './helpers/jarvis-invoice-attachment.helper';

const user = { companyId: 'company-1' } as AuthenticatedUser;
const id = '11111111-1111-4111-8111-111111111111';
const bytes = Buffer.from('%PDF-1.7\nContenido de prueba\n%%EOF');
const file = { originalname: 'soporte.pdf', buffer: bytes, mimetype: 'application/pdf' } as Express.Multer.File;
function setup() {
  const attachment = readInvoiceAttachment(file);
  const query = jest.fn().mockResolvedValue([{ attachment }]);
  return { query, attachment, controller: new JarvisInvoiceAttachmentsController({ query } as never) };
}
it('guarda los bytes y conserva el formulario dentro del borrador de la empresa', async () => {
  const { query, controller, attachment } = setup();
  query.mockResolvedValue([{ attachment: attachmentMetadata(attachment) }]);
  expect(await controller.save(user, id, 'ELECTRONIC_INVOICE', file)).toEqual({ attachment: attachmentMetadata(attachment) });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain("jsonb_set(jarvis_invoice_drafts.state,'{__attachment}'");
  expect(sql).toContain('jarvis_invoice_drafts.company_id=EXCLUDED.company_id');
  expect(params.slice(0, 3)).toEqual([id, 'company-1', 'ELECTRONIC_INVOICE']);
  expect(Buffer.from(JSON.parse(params[3]).dataBase64, 'base64')).toEqual(bytes);
});
it.each(['draft', 'invoice'] as const)('recupera el archivo completo desde %s y exige la empresa autenticada', async method => {
  const { query, controller } = setup();
  const stream = await controller[method](user, id);
  expect(stream.getStream().read()).toEqual(bytes);
  expect(stream.getHeaders()).toMatchObject({ type: 'application/pdf', length: bytes.length });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('company_id=$2'), [id, 'company-1']);
});
it('rechaza adjuntos de otra empresa y documentos sin archivo', async () => {
  const { query, controller } = setup();
  query.mockResolvedValue([]);
  await expect(controller.invoice(user, id)).rejects.toBeInstanceOf(NotFoundException);
  await expect(controller.draft(user, id)).rejects.toBeInstanceOf(NotFoundException);
  await expect(controller.save(user, id, 'ELECTRONIC_INVOICE', file)).rejects.toBeInstanceOf(NotFoundException);
});
it('elimina el adjunto sin eliminar el borrador y aísla la empresa', async () => {
  const { query, controller } = setup();
  await controller.remove(user, id);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("state=state-'__attachment'"), [id, 'company-1']);
});
it('consulta el archivo antes de emitir y exige el mismo tipo de documento', async () => {
  const { query, attachment } = setup();
  expect(await loadDraftAttachment({ query } as never, 'company-1', 'ELECTRONIC_INVOICE', id)).toEqual(attachment);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('document_kind=$3'), [id, 'company-1', 'ELECTRONIC_INVOICE']);
  query.mockResolvedValue([]);
  await expect(loadDraftAttachment({ query } as never, 'company-2', 'CREDIT_NOTE', id)).rejects.toBeInstanceOf(NotFoundException);
});
it('no carga archivos cuando la factura no tiene adjunto', async () => {
  const { query } = setup();
  expect(await loadDraftAttachment({ query } as never, 'company', 'ELECTRONIC_INVOICE')).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
});
it('rechaza contenido ajeno al formato anunciado y archivos demasiado grandes', () => {
  expect(() => readInvoiceAttachment({ ...file, buffer: Buffer.from('<script>contenido</script>') })).toThrow('contenido');
  expect(() => readInvoiceAttachment({ ...file, buffer: Buffer.alloc(MAX_INVOICE_ATTACHMENT_BYTES + 1) })).toThrow(PayloadTooLargeException);
  expect(() => readInvoiceAttachment()).toThrow('Selecciona');
});
it.each([
  ['image/png', Buffer.from('89504e470d0a1a0a00000000', 'hex')],
  ['image/jpeg', Buffer.from('ffd8ffe00000ffd9', 'hex')],
])('detecta %s por su contenido y no por el nombre o MIME del cliente', (mime, buffer) => {
  expect(readInvoiceAttachment({ ...file, buffer, originalname: '../foto', mimetype: 'application/octet-stream' })).toMatchObject({ name: 'foto', mimeType: mime, size: buffer.length });
});
