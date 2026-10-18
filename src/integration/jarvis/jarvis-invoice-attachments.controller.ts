import { Body, Controller, Delete, Get, Header, NotFoundException, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { MAX_INVOICE_ATTACHMENT_BYTES, readInvoiceAttachment, type StoredInvoiceAttachment } from './helpers/jarvis-invoice-attachment.helper';

@Controller('integrations/jarvis')
export class JarvisInvoiceAttachmentsController {
  constructor(private readonly source: DataSource) {}

  @Post('drafts/:id/attachment')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_INVOICE_ATTACHMENT_BYTES, files: 1 } }))
  async save(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body('documentKind') kind: string, @UploadedFile() file?: Express.Multer.File) {
    if (!['ELECTRONIC_INVOICE', 'SUPPORT_DOCUMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_CREDIT_NOTE'].includes(kind)) throw new BadRequestException('Tipo de documento inválido.');
    const attachment = readInvoiceAttachment(file);
    const [saved] = await this.source.query(`INSERT INTO jarvis_invoice_drafts (id,company_id,document_kind,state)
      VALUES ($1,$2,$3,jsonb_build_object('__attachment',$4::jsonb))
      ON CONFLICT (id) DO UPDATE SET state=jsonb_set(jarvis_invoice_drafts.state,'{__attachment}',$4::jsonb,true),updated_at=now()
      WHERE jarvis_invoice_drafts.company_id=EXCLUDED.company_id AND jarvis_invoice_drafts.document_kind=EXCLUDED.document_kind
      RETURNING (state->'__attachment') - 'dataBase64' AS attachment`, [id, getAuthenticatedCompanyId(user), kind, JSON.stringify(attachment)]);
    if (!saved) throw new NotFoundException('No se encontró el documento de esta empresa.');
    return { attachment: saved.attachment };
  }

  @Delete('drafts/:id/attachment')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.source.query("UPDATE jarvis_invoice_drafts SET state=state-'__attachment',updated_at=now() WHERE id=$1 AND company_id=$2", [id, getAuthenticatedCompanyId(user)]);
    return { deleted: true };
  }

  @Get('drafts/:id/attachment')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async draft(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.source.query("SELECT state->'__attachment' AS attachment FROM jarvis_invoice_drafts WHERE id=$1 AND company_id=$2", [id, getAuthenticatedCompanyId(user)]);
    return this.file(row?.attachment);
  }

  @Get('invoices/:id/attachment')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async invoice(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await this.source.query("SELECT source_request->'attachment' AS attachment FROM jarvis_sales_invoices WHERE id=$1 AND company_id=$2", [id, getAuthenticatedCompanyId(user)]);
    return this.file(row?.attachment);
  }

  private file(attachment?: StoredInvoiceAttachment) {
    if (!attachment?.dataBase64) throw new NotFoundException('Este documento no tiene un adjunto guardado.');
    const buffer = Buffer.from(attachment.dataBase64, 'base64');
    return new StreamableFile(buffer, { type: attachment.mimeType, length: buffer.length, disposition: `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}` });
  }
}
