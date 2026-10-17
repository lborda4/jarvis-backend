import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
export interface SalesInvoiceHistoryQuery { search?: string; from?: string; to?: string; page?: string; }
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
    return { ...detail, status: 'SENT' as const };
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
    return { items, total: Number(count.total), page, pageSize };
  }
}
