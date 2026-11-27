import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';

const KINDS = ['ELECTRONIC_INVOICE', 'SUPPORT_DOCUMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_CREDIT_NOTE'];
export class SaveInvoiceDraftDto {
  documentKind: string;
  state: Record<string, unknown>;
}

@Controller('integrations/jarvis/drafts')
export class JarvisInvoiceDraftsController {
  constructor(private readonly source: DataSource) {}

  private kind(value: string) {
    if (!KINDS.includes(value)) throw new BadRequestException('Tipo de borrador invalido.');
    return value;
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query('kind') kind: string) {
    const items = await this.source.query(`SELECT id, document_kind AS "documentKind",
      state->'selectedCustomer'->>'name' AS "customerName", state->>'issueDate' AS "issueDate",
      updated_at AS "updatedAt" FROM jarvis_invoice_drafts
      WHERE company_id=$1 AND document_kind=$2 ORDER BY updated_at DESC`,
      [getAuthenticatedCompanyId(user), this.kind(kind)]);
    return { items };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [draft] = await this.source.query(`SELECT id, document_kind AS "documentKind", state - '__attachment' AS state,
      (state->'__attachment') - 'dataBase64' AS attachment
      FROM jarvis_invoice_drafts WHERE id=$1 AND company_id=$2`, [id, getAuthenticatedCompanyId(user)]);
    if (!draft) throw new NotFoundException('Borrador no encontrado.');
    if (draft.attachment) draft.state = { ...draft.state, attachment: draft.attachment };
    delete draft.attachment;
    return { draft };
  }

  @Put(':id')
  async save(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() request: SaveInvoiceDraftDto) {
    const kind = this.kind(request?.documentKind);
    if (!request?.state || typeof request.state !== 'object' || Array.isArray(request.state)) {
      throw new BadRequestException('El borrador no es valido.');
    }
    const { __attachment: _internalAttachment, attachment: _metadata, ...fields } = request.state;
    const state = JSON.stringify(fields);
    if (Buffer.byteLength(state, 'utf8') > 1024 * 1024) throw new BadRequestException('El borrador es demasiado grande.');
    const [draft] = await this.source.query(`INSERT INTO jarvis_invoice_drafts (id,company_id,document_kind,state)
      VALUES ($1,$2,$3,$4::jsonb)
      ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state ||
        CASE WHEN jarvis_invoice_drafts.state ? '__attachment' THEN jsonb_build_object('__attachment',jarvis_invoice_drafts.state->'__attachment') ELSE '{}'::jsonb END,
        updated_at=now()
      WHERE jarvis_invoice_drafts.company_id=EXCLUDED.company_id
        AND jarvis_invoice_drafts.document_kind=EXCLUDED.document_kind
        AND NOT (jarvis_invoice_drafts.document_kind='ELECTRONIC_INVOICE'
          AND COALESCE(jarvis_invoice_drafts.state->>'importSource','')='sales-excel-v1'
          AND (jarvis_invoice_drafts.state ? 'importDelivery' OR COALESCE(EXCLUDED.state->>'importSource','')='sales-excel-v1'))
      RETURNING id`, [id, getAuthenticatedCompanyId(user), kind, state]);
    if (!draft) throw new NotFoundException('Borrador no encontrado.');
    return { draft };
  }

  @Post(':id/sales-import-claim')
  async claimSalesImport(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() request: { state: Record<string, unknown> }) {
    if (!request?.state || typeof request.state !== 'object' || Array.isArray(request.state))
      throw new BadRequestException('El borrador no es válido.');
    const { __attachment: _attachment, attachment: _metadata, ...state } = request.state;
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) throw new BadRequestException('El borrador es demasiado grande.');
    const token = randomUUID();
    const [draft] = await this.source.query(`WITH claimed AS (UPDATE jarvis_invoice_drafts
      SET state=jsonb_set(state,'{importDelivery}',jsonb_build_object('status','sending','claimToken',$4::text),true), updated_at=now()
      WHERE id=$1 AND company_id=$2 AND document_kind='ELECTRONIC_INVOICE'
        AND state->>'importSource'='sales-excel-v1' AND NOT state ? 'importDelivery'
        AND state - '__attachment'=$3::jsonb
      RETURNING id) SELECT id FROM claimed`, [id, getAuthenticatedCompanyId(user), serialized, token]);
    if (!draft) throw new ConflictException('El borrador cambió o ya tiene un envío en curso. Revisa el historial antes de continuar.');
    return { token };
  }

  @Post(':id/sales-import-complete')
  async completeSalesImport(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() request: { token: string; invoiceId?: string }) {
    if (typeof request?.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.token) ||
      (request.invoiceId !== undefined && (typeof request.invoiceId !== 'string' || request.invoiceId.length > 100)))
      throw new BadRequestException('La confirmación del envío no es válida.');
    const [draft] = await this.source.query(`WITH completed AS (UPDATE jarvis_invoice_drafts
      SET state=jsonb_set(state,'{importDelivery}',jsonb_strip_nulls(jsonb_build_object('status','sent','invoiceId',$4::text)),true), updated_at=now()
      WHERE id=$1 AND company_id=$2 AND document_kind='ELECTRONIC_INVOICE'
        AND state->>'importSource'='sales-excel-v1' AND state->'importDelivery'->>'status'='sending'
        AND state->'importDelivery'->>'claimToken'=$3
      RETURNING id) SELECT id FROM completed`, [id, getAuthenticatedCompanyId(user), request.token, request.invoiceId ?? null]);
    if (!draft) throw new ConflictException('No se pudo confirmar el envío del borrador. Revisa el historial.');
    return { draft };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [deleted] = await this.source.query(`WITH deleted AS (DELETE FROM jarvis_invoice_drafts WHERE id=$1 AND company_id=$2
      AND NOT (document_kind='ELECTRONIC_INVOICE' AND COALESCE(state->>'importSource','')='sales-excel-v1' AND state ? 'importDelivery')
      RETURNING id) SELECT id FROM deleted`, [id, getAuthenticatedCompanyId(user)]);
    if (!deleted) {
      const [protectedDraft] = await this.source.query(`SELECT id FROM jarvis_invoice_drafts
        WHERE id=$1 AND company_id=$2 AND document_kind='ELECTRONIC_INVOICE'
          AND state->>'importSource'='sales-excel-v1' AND state ? 'importDelivery'`, [id, getAuthenticatedCompanyId(user)]);
      if (protectedDraft) throw new ConflictException('El borrador está protegido por un envío. Revisa el historial.');
    }
    return { deleted: true };
  }
}
