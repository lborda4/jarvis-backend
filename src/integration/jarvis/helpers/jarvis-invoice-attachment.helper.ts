import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

export const MAX_INVOICE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export interface InvoiceAttachmentMetadata { name: string; mimeType: string; size: number }
export interface StoredInvoiceAttachment extends InvoiceAttachmentMetadata { dataBase64: string }

export function attachmentMetadata(attachment?: StoredInvoiceAttachment | null): InvoiceAttachmentMetadata | undefined {
  if (!attachment) return undefined;
  return { name: attachment.name, mimeType: attachment.mimeType, size: attachment.size };
}

export function readInvoiceAttachment(file?: Express.Multer.File): StoredInvoiceAttachment {
  const data = file?.buffer;
  if (!data?.length) throw new BadRequestException('Selecciona un archivo PDF, JPG o PNG.');
  if (data.length > MAX_INVOICE_ATTACHMENT_BYTES) throw new PayloadTooLargeException('El archivo no puede superar los 10 MB.');
  let mimeType: string;
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') mimeType = 'application/pdf';
  else if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) mimeType = 'image/png';
  else if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[data.length - 2] === 255 && data[data.length - 1] === 217) mimeType = 'image/jpeg';
  else throw new BadRequestException('El contenido del archivo debe ser PDF, JPG o PNG.');
  const name = file!.originalname.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200);
  if (!name) throw new BadRequestException('El nombre del archivo no es válido.');
  return { name, mimeType, size: data.length, dataBase64: data.toString('base64') };
}

export async function loadDraftAttachment(source: Pick<DataSource, 'query'>, companyId: string, kind: string, id?: string): Promise<StoredInvoiceAttachment | undefined> {
  if (id === undefined) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException('El adjunto no es válido.');
  const [draft] = await source.query("SELECT state->'__attachment' AS attachment FROM jarvis_invoice_drafts WHERE id=$1 AND company_id=$2 AND document_kind=$3", [id, companyId, kind]);
  if (!draft?.attachment?.dataBase64) throw new NotFoundException('No se encontró el adjunto guardado de este documento. Vuelve a adjuntarlo antes de enviar.');
  return draft.attachment;
}
