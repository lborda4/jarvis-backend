import { calculateJarvisRetention } from './helpers/jarvis-tax-calculation.helper';
import type { CreateJarvisInvoiceRequestDto } from './dto/create-jarvis-invoice.dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { IntegrationProvider } from '../enums/integration-provider.enum';

@Injectable()
export class JarvisDashboardService {
  constructor(private readonly dataSource: DataSource, private readonly integrations: IntegrationsRepository) {}
  async summary(companyId: string, month?: string) {
    if (!companyId) throw new BadRequestException('La empresa activa es obligatoria.');
    const selected = month ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(new Date());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) throw new BadRequestException('El mes no es válido.');
    if (!await this.integrations.findByCompanyAndProvider(companyId, IntegrationProvider.JARVIS)) throw new NotFoundException('La empresa no tiene integración Jarvis activa.');
    const start = new Date(selected + '-01T00:00:00Z');
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const first = new Date(start); first.setUTCMonth(first.getUTCMonth() - 5);
    const rows = await this.dataSource.query(`
      SELECT to_char(issue_date, 'YYYY-MM') AS month, document_kind AS kind,
        sum(total)::text AS total, count(*)::int AS count,
        count(source_request)::int AS detailed,
        sum(COALESCE((SELECT sum(COALESCE((line->>'taxAmount')::numeric, 0))
          FROM jsonb_array_elements(COALESCE(source_request->'items', '[]'::jsonb)) line
          WHERE COALESCE((line->>'taxId')::int, 1) = 1), 0))::text AS iva
      FROM jarvis_sales_invoices
      WHERE company_id = $1 AND issue_date >= $2 AND issue_date < $3
        AND currency = 'COP' AND document_kind IN ('ELECTRONIC_INVOICE', 'SUPPORT_DOCUMENT', 'CREDIT_NOTE')
      GROUP BY to_char(issue_date, 'YYYY-MM'), document_kind
    `, [companyId, first.toISOString().slice(0,10), end.toISOString().slice(0,10)]);
    const series = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(first); date.setUTCMonth(date.getUTCMonth() + index);
      const month = date.toISOString().slice(0,7);
      const sale = rows.find(row => row.month === month && row.kind === 'ELECTRONIC_INVOICE');
      const support = rows.find(row => row.month === month && row.kind === 'SUPPORT_DOCUMENT');
      const credit = rows.find(row => row.month === month && row.kind === 'CREDIT_NOTE');
      const sales = Number(sale?.total ?? 0);
      const creditNotes = Number(credit?.total ?? 0);
      return { month, sales, creditNotes, netSales: Number((sales - creditNotes).toFixed(2)), support: Number(support?.total ?? 0), salesCount: Number(sale?.count ?? 0), creditNotesCount: Number(credit?.count ?? 0), supportCount: Number(support?.count ?? 0) };
    });
    const details: { document_kind: string; source_request: CreateJarvisInvoiceRequestDto | null }[] = await this.dataSource.query(
      "SELECT document_kind, source_request FROM jarvis_sales_invoices WHERE company_id=$1 AND issue_date >= $2 AND issue_date < $3 AND currency='COP' AND document_kind IN ('ELECTRONIC_INVOICE','SUPPORT_DOCUMENT','CREDIT_NOTE')",
      [companyId, start.toISOString().slice(0,10), end.toISOString().slice(0,10)],
    );
    const retentions = { reteRenta: 0, reteIca: 0, reteIva: 0 };
    const creditRetentions = { reteRenta: 0, reteIca: 0, reteIva: 0 };
    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    for (const { document_kind, source_request: request } of details) {
      if (!request?.items) continue;
      const base = round(request.items.reduce((sum, item) => sum + round(Number(item.quantity) * Number(item.unitValue) - Number(item.discount ?? 0)), 0) - Number(request.discountAmount ?? 0));
      const iva = round(request.items.reduce((sum, item) => sum + Number(item.taxAmount ?? 0), 0));
      const entries = [
        ...(request.retentions ?? []).map(retention => ({ retention, base, iva })),
        ...request.items.filter(item => item.retention).map(item => ({ retention: item.retention!, base: round(Number(item.quantity) * Number(item.unitValue) - Number(item.discount ?? 0)), iva: Number(item.taxAmount ?? 0) })),
      ];
      for (const { retention, base, iva } of entries) {
        const kind = (retention.type ?? '').toLowerCase().replace(/[^a-z]/g, '');
        const key = kind === 'reteiva' ? 'reteIva' : kind === 'reteica' ? 'reteIca' : kind === 'reterenta' || kind === 'retefuente' ? 'reteRenta' : null;
        if (!key || !retention.id) continue;
        const target = document_kind === 'CREDIT_NOTE' ? creditRetentions : retentions;
        target[key] = round(target[key] + calculateJarvisRetention(retention.type ?? '', Number(retention.percentage ?? 0), base, iva).amount);
      }
    }
    const products = new Map<string, { code: string; name: string; quantity: number; returnedQuantity: number; netQuantity: number; sales: number }>();
    for (const record of details) {
      if (!['ELECTRONIC_INVOICE', 'CREDIT_NOTE'].includes(record.document_kind)) continue;
      const isCredit = record.document_kind === 'CREDIT_NOTE';
      for (const line of record.source_request?.items ?? []) {
        const name = line.description?.trim();
        const code = line.code?.trim() ?? '';
        const quantity = Number(line.quantity);
        const value = round(quantity * Number(line.unitValue) - Number(line.discount ?? 0));
        if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(value)) continue;
        const key = (code || name).toLowerCase();
        const product = products.get(key) ?? { code, name, quantity: 0, returnedQuantity: 0, netQuantity: 0, sales: 0 };
        if (isCredit) product.returnedQuantity += quantity;
        else product.quantity += quantity;
        product.netQuantity = product.quantity - product.returnedQuantity;
        product.sales = round(product.sales + (isCredit ? -1 : 1) * Math.max(0, value));
        products.set(key, product);
      }
    }
    const topProducts = [...products.values()].sort((a, b) => b.sales - a.sales || b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 5);
    const sales = rows.find(row => row.month === selected && row.kind === 'ELECTRONIC_INVOICE');
    const credits = rows.find(row => row.month === selected && row.kind === 'CREDIT_NOTE');
    const generated = { iva: Number(sales?.iva ?? 0), ...retentions };
    const creditNotes = { iva: Number(credits?.iva ?? 0), ...creditRetentions };
    const net = {
      iva: round(generated.iva - creditNotes.iva),
      reteRenta: round(generated.reteRenta - creditNotes.reteRenta),
      reteIca: round(generated.reteIca - creditNotes.reteIca),
      reteIva: round(generated.reteIva - creditNotes.reteIva),
    };
    return { month: selected, series, topProducts, current: series[5], taxes: { ...net, generated, creditNotes, detailedDocuments: Number(sales?.detailed ?? 0), salesDocuments: Number(sales?.count ?? 0), creditNoteDocuments: Number(credits?.count ?? 0), detailedCreditNoteDocuments: Number(credits?.detailed ?? 0), retentionDocuments: details.filter(row => row.source_request != null).length, documents: details.length } };
  }
}
