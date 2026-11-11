import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import { attachmentMetadata } from './helpers/jarvis-invoice-attachment.helper';
export interface SalesInvoiceHistoryQuery { search?: string; from?: string; to?: string; page?: string; }
type InvoiceAdjustmentStatus = 'NONE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'CREDIT_AND_DEBIT';
interface AdjustmentInvoice { status: 'SENT' | 'SAVED'; prefix: string; number: string; cufe: string | null; }
interface IssuedAdjustment { kind: string; referenceUuid: string | null; referenceNumber: string | null; }

@Injectable()
export class JarvisInvoiceHistoryService {
  constructor(@InjectRepository(JarvisSalesInvoice) private readonly repository: Repository<JarvisSalesInvoice>) {}
  async record(invoice: Pick<JarvisSalesInvoice, 'companyId' | 'providerId' | 'prefix' | 'number' | 'issueDate' | 'customerName' | 'customerIdentification' | 'currency' | 'total' | 'cufe'> & { documentKind?: JarvisResolutionKind; invoiceXml?: string | null; sourceRequest?: JarvisSalesInvoice["sourceRequest"] }): Promise<string | undefined> {
    await this.repository.upsert({ ...invoice, documentKind: invoice.documentKind ?? JarvisResolutionKind.ELECTRONIC_INVOICE }, ['companyId', 'documentKind', 'prefix', 'number']);
    const saved = await this.repository.findOne({ where: { companyId: invoice.companyId, documentKind: invoice.documentKind ?? JarvisResolutionKind.ELECTRONIC_INVOICE, prefix: invoice.prefix, number: invoice.number }, select: { id: true } });
    return saved?.id;
  }
  async detail(companyId: string, id: string, documentKind = JarvisResolutionKind.ELECTRONIC_INVOICE) {
    if (!companyId?.trim()) throw new BadRequestException('La empresa activa es obligatoria.');
    const invoice = await this.repository.createQueryBuilder('invoice')
      .addSelect('invoice.sourceRequest')
      .where('invoice.companyId = :companyId', { companyId: companyId.trim() })
      .andWhere('invoice.id = :id', { id })
      .andWhere('invoice.documentKind = :kind', { kind: documentKind })
      .getOne();
    if (!invoice) throw new NotFoundException(documentKind === JarvisResolutionKind.SUPPORT_DOCUMENT ? 'No se encontró el documento soporte.' : 'No se encontró la factura.');
    const { companyId: _company, company: _relation, ...detail } = invoice;
    const sourceRequest = detail.sourceRequest ? { ...detail.sourceRequest, attachment: attachmentMetadata(detail.sourceRequest.attachment) } : detail.sourceRequest;
    return { ...detail, sourceRequest, status: 'SENT' as const };
  }
  async list(companyId: string, filters: SalesInvoiceHistoryQuery = {}, documentKind = JarvisResolutionKind.ELECTRONIC_INVOICE) {
    if (!companyId?.trim()) throw new BadRequestException('La empresa activa es obligatoria.');
    const page = filters.page === undefined ? 1 : Number(filters.page);
    if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException('La pagina no es valida.');
    for (const date of [filters.from, filters.to]) {
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new BadRequestException('La fecha no es valida.');
    }
    if (filters.from && filters.to && filters.from > filters.to) throw new BadRequestException('La fecha inicial no puede superar la final.');
    const pageSize = 20;
    const documents = `WITH documents AS (
      SELECT id, provider_id AS "providerId", prefix, number,
        issue_date::text AS "issueDate", customer_name AS "customerName",
        customer_identification AS "customerIdentification", currency, total::text AS total,
        cufe, sent_at AS "sentAt", 'SENT'::text AS status
      FROM jarvis_sales_invoices WHERE company_id=$1 AND document_kind=$2
      UNION ALL
      SELECT id, ''::text, ''::text, ''::text,
        COALESCE(state->>'issueDate',''), COALESCE(state->'selectedCustomer'->>'name',''),
        COALESCE(state->'selectedCustomer'->>'document_number',''), COALESCE(state->>'currency','COP'),
        CASE WHEN state->>'documentTotal' ~ '^-?[0-9]+([.][0-9]+)?$' THEN state->>'documentTotal' ELSE '' END,
        NULL::text, updated_at, 'SAVED'::text
      FROM jarvis_invoice_drafts WHERE company_id=$1 AND document_kind=$2
    )`;
    const parameters: unknown[] = [companyId.trim(), documentKind];
    const conditions: string[] = [];
    const search = filters.search?.trim();
    if (search) {
      parameters.push('%' + search + '%');
      const index = parameters.length;
      conditions.push(`("customerName" ILIKE $${index} OR "customerIdentification" ILIKE $${index} OR CONCAT(prefix,number) ILIKE $${index} OR cufe ILIKE $${index})`);
    }
    if (filters.from) { parameters.push(filters.from); conditions.push(`"issueDate" >= $${parameters.length}`); }
    if (filters.to) { parameters.push(filters.to); conditions.push(`"issueDate" <= $${parameters.length}`); }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const [count] = await this.repository.query(documents + ' SELECT COUNT(*) AS total FROM documents' + where, parameters);
    const items = await this.repository.query(documents + ' SELECT * FROM documents' + where +
      ` ORDER BY "sentAt" DESC,id DESC LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, pageSize, (page - 1) * pageSize]);
    const result = documentKind === JarvisResolutionKind.ELECTRONIC_INVOICE
      ? await this.withAdjustmentStatus(companyId.trim(), items)
      : items;
    return { items: result, total: Number(count.total), page, pageSize };
  }

  private async withAdjustmentStatus<T extends AdjustmentInvoice>(companyId: string, items: T[]): Promise<Array<T & { adjustmentStatus: InvoiceAdjustmentStatus }>> {
    const uuid = (value: string | null | undefined) => value?.trim().toLowerCase() || '';
    const invoiceNumber = (invoice: AdjustmentInvoice) => {
      const prefix = invoice.prefix?.trim() || '';
      const number = invoice.number?.trim() || '';
      return (number.startsWith(prefix) ? number : prefix + number).toUpperCase();
    };
    const sent = items.filter(item => item.status === 'SENT');
    const cufes = [...new Set(sent.map(item => uuid(item.cufe)).filter(Boolean))];
    const numbers = [...new Set(sent.filter(item => !uuid(item.cufe)).map(invoiceNumber).filter(Boolean))];
    const notes: IssuedAdjustment[] = cufes.length || numbers.length ? await this.repository.query(
      `SELECT document_kind AS kind,
        source_request->'billingReference'->>'uuid' AS "referenceUuid",
        source_request->'billingReference'->>'number' AS "referenceNumber"
      FROM jarvis_sales_invoices
      WHERE company_id=$1 AND document_kind IN ('CREDIT_NOTE','DEBIT_NOTE')
        AND (LOWER(BTRIM(source_request->'billingReference'->>'uuid')) = ANY($2::text[])
          OR UPPER(BTRIM(source_request->'billingReference'->>'number')) = ANY($3::text[]))`,
      [companyId, cufes, numbers],
    ) : [];
    const byUuid = new Map<string, number>();
    const byNumber = new Map<string, number>();
    for (const note of notes) {
      const flag = note.kind === JarvisResolutionKind.CREDIT_NOTE ? 1 : note.kind === JarvisResolutionKind.DEBIT_NOTE ? 2 : 0;
      const referenceUuid = uuid(note.referenceUuid);
      const referenceNumber = note.referenceNumber?.trim().toUpperCase();
      if (referenceUuid) byUuid.set(referenceUuid, (byUuid.get(referenceUuid) ?? 0) | flag);
      if (referenceNumber) byNumber.set(referenceNumber, (byNumber.get(referenceNumber) ?? 0) | flag);
    }
    return items.map(item => {
      const referenceUuid = uuid(item.cufe);
      const flag = item.status !== 'SENT' ? 0
        : referenceUuid ? byUuid.get(referenceUuid) ?? 0 : byNumber.get(invoiceNumber(item)) ?? 0;
      const adjustmentStatus: InvoiceAdjustmentStatus = flag === 3 ? 'CREDIT_AND_DEBIT' : flag === 1 ? 'CREDIT_NOTE' : flag === 2 ? 'DEBIT_NOTE' : 'NONE';
      return { ...item, adjustmentStatus };
    });
  }

}
