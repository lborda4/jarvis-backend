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
  async detail(companyId: string, id: string) {
    if (!companyId?.trim()) throw new BadRequestException('La empresa activa es obligatoria.');
    const invoice = await this.repository.createQueryBuilder('invoice')
      .addSelect('invoice.sourceRequest')
      .where('invoice.companyId = :companyId', { companyId: companyId.trim() })
      .andWhere('invoice.id = :id', { id })
      .andWhere('invoice.documentKind = :kind', { kind: JarvisResolutionKind.ELECTRONIC_INVOICE })
      .getOne();
    if (!invoice) throw new NotFoundException('No se encontró la factura.');
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
    const query = this.repository.createQueryBuilder('invoice').where('invoice.companyId = :companyId', { companyId: companyId.trim() });
    query.andWhere('invoice.documentKind = :documentKind', { documentKind });
    const search = filters.search?.trim();
    if (search) query.andWhere("(invoice.customerName ILIKE :search OR invoice.customerIdentification ILIKE :search OR CONCAT(invoice.prefix, invoice.number) ILIKE :search OR invoice.cufe ILIKE :search)", { search: '%' + search + '%' });
    if (filters.from) query.andWhere('invoice.issueDate >= :from', { from: filters.from });
    if (filters.to) query.andWhere('invoice.issueDate <= :to', { to: filters.to });
    const [items, total] = await query.orderBy('invoice.sentAt', 'DESC').addOrderBy('invoice.id', 'DESC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items: items.map(({ companyId: _company, company: _relation, ...invoice }) => ({ ...invoice, status: 'SENT' as const })), total, page, pageSize };
  }
}
