import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Workbook } from 'exceljs';
import { DataSource } from 'typeorm';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import {
  calculateJarvisReport,
  reportColumns,
} from './helpers/jarvis-report-calculation.helper';
import {
  REPORT_TYPES,
  type ReportDocument,
  type ReportFilters,
  type ReportQuery,
  type ReportResult,
  type ReportRow,
  type ReportColumn,
} from './jarvis-reports.types';

const salesKinds = ['ELECTRONIC_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const taxKinds = [...salesKinds, 'SUPPORT_DOCUMENT', 'SUPPORT_CREDIT_NOTE'];
const conventions = [
  'Solo comprobantes del historial de emisión aceptada de JARVIS. Se excluyen borradores y rechazos DIAN.',
  'Las notas crédito y de ajuste restan; las notas débito suman. Cada comprobante se atribuye a su fecha de emisión.',
  'Ventas brutas y netas corresponden a subtotales antes de impuestos. Valor total conserva el importe registrado; valor después de retenciones lo descuenta.',
  'En ventas las retenciones son las que nos practicaron. En documentos soporte son las practicadas por nosotros.',
  'Las monedas se consolidan por separado y no se convierten.',
  'Los filtros de cliente, vendedor y producto buscan en los datos conservados del comprobante, no en los catálogos actuales.',
  'Las notas sin vendedores propios heredan los de su factura vinculada, incluso si fue emitida en otro período.',
];
export function validateReportQuery(query: ReportQuery): ReportFilters {
  const text = (key: keyof ReportQuery, fallback = '') => {
    const value = query[key];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > 200)
    )
      throw new BadRequestException(`El filtro ${key} no es válido.`);
    return value?.trim() || fallback;
  };
  const report = text('report', 'sales');
  const view = text('view', 'summary');
  if (!REPORT_TYPES.includes(report as ReportFilters['report']))
    throw new BadRequestException('El reporte no es válido.');
  if (!['summary', 'detail'].includes(view))
    throw new BadRequestException('La vista no es válida.');
  const from = text('from');
  const to = text('to');
  for (const date of [from, to]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new BadRequestException(
        'Selecciona fechas de inicio y fin válidas.',
      );
  }
  if (from > to)
    throw new BadRequestException(
      'La fecha inicial no puede superar la fecha final.',
    );
  const kind = text('kind');
  if (kind && !(report === 'taxes' ? taxKinds : salesKinds).includes(kind))
    throw new BadRequestException(
      'El tipo de comprobante no corresponde al reporte.',
    );
  const currency = text('currency').toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency))
    throw new BadRequestException(
      'La moneda debe ser un código ISO de tres letras.',
    );
  const page = Number(text('page', '1'));
  const pageSize = Number(text('pageSize', '20'));
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    ![10, 20, 50, 100].includes(pageSize)
  )
    throw new BadRequestException('La paginación no es válida.');
  return {
    report: report as ReportFilters['report'],
    view: view as ReportFilters['view'],
    from,
    to,
    kind,
    currency,
    ...(text('search') ? { search: text('search') } : {}),
    customer: text('customer'),
    seller: text('seller'),
    product: text('product'),
    page,
    pageSize,
  };
}

@Injectable()
export class JarvisReportsService {
  constructor(
    private readonly source: DataSource,
    private readonly integrations: IntegrationsRepository,
  ) {}

  private async dataset(companyId: string, query: ReportQuery) {
    if (!companyId?.trim())
      throw new BadRequestException('La empresa activa es obligatoria.');
    const filters = validateReportQuery(query);
    if (
      !(await this.integrations.findByCompanyAndProvider(
        companyId,
        IntegrationProvider.JARVIS,
      ))
    )
      throw new NotFoundException('La empresa no tiene integración JARVIS.');
    const params: unknown[] = [
      companyId,
      filters.from,
      filters.to,
      filters.kind
        ? [filters.kind]
        : filters.report === 'taxes'
          ? taxKinds
          : salesKinds,
    ];
    const conditions: string[] = [];
    if (filters.currency) {
      params.push(filters.currency);
      conditions.push(`i.currency=$${params.length}`);
    }
    if (filters.search) {
      params.push(filters.search);
      conditions.push(
        `strpos(lower(concat_ws(' ', i.customer_identification, i.customer_name, i.prefix || i.number)), lower($${params.length})) > 0`,
      );
    }
    if (filters.customer) {
      params.push(filters.customer);
      conditions.push(
        `strpos(lower(i.customer_identification || ' ' || i.customer_name), lower($${params.length})) > 0`,
      );
    }
    // Esta tabla solo se escribe tras confirmación DIAN; no consultar drafts ni intentos rechazados.
    const documents = await this.source.query<ReportDocument[]>(
      `
      SELECT i.id, i.document_kind AS kind, i.issue_date::text AS date,
        CASE WHEN left(i.number,length(i.prefix))=i.prefix THEN i.number ELSE i.prefix || i.number END AS number,
        i.customer_identification AS "customerId", i.customer_name AS "customerName",
        i.currency, i.total::text AS total, i.source_request AS source,
        reference.sellers AS "referenceSellers"
      FROM jarvis_sales_invoices i
      LEFT JOIN LATERAL (
        SELECT original.source_request->'sellers' AS sellers FROM jarvis_sales_invoices original
        WHERE original.company_id=i.company_id AND original.document_kind='ELECTRONIC_INVOICE'
          AND lower(original.cufe)=lower(i.source_request->'billingReference'->>'uuid')
        ORDER BY original.sent_at DESC, original.id LIMIT 1
      ) reference ON i.document_kind IN ('CREDIT_NOTE','DEBIT_NOTE')
      WHERE i.company_id=$1 AND i.issue_date >= $2::date AND i.issue_date <= $3::date
        AND i.document_kind=ANY($4::text[]) ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}
      ORDER BY i.issue_date DESC,i.sent_at DESC,i.id
    `,
      params,
    );
    const result = calculateJarvisReport(documents, filters);
    return {
      filters,
      ...result,
      warnings: [...conventions, ...result.warnings],
    };
  }

  async query(companyId: string, query: ReportQuery): Promise<ReportResult> {
    const data = await this.dataset(companyId, query);
    const rows = data[data.filters.view];
    const page = Math.min(
      data.filters.page,
      Math.max(1, Math.ceil(rows.length / data.filters.pageSize)),
    );
    return {
      filters: { ...data.filters, page },
      columns: reportColumns(data.filters),
      items: rows.slice(
        (page - 1) * data.filters.pageSize,
        page * data.filters.pageSize,
      ),
      total: rows.length,
      page,
      pageSize: data.filters.pageSize,
      totals: data.totals,
      warnings: data.warnings,
    };
  }

  async export(companyId: string, query: ReportQuery) {
    const data = await this.dataset(companyId, query);
    const book = new Workbook();
    book.creator = 'JARVIS';
    book.created = new Date();
    const addSheet = (
      name: string,
      columns: ReportColumn[],
      rows: ReportRow[],
    ): void => {
      const maxRows = 1048575;
      if (rows.length > maxRows) {
        for (let offset = 0; offset < rows.length; offset += maxRows)
          addSheet(
            `${name} ${Math.floor(offset / maxRows) + 1}`,
            columns,
            rows.slice(offset, offset + maxRows),
          );
        return;
      }
      const sheet = book.addWorksheet(name);
      sheet.columns = columns.map((column) => ({
        header: column.label,
        key: column.key,
        width: column.format === 'text' ? 28 : 22,
      }));
      rows.forEach((row) =>
        sheet.addRow(
          Object.fromEntries(
            columns.map((column) => [column.key, row[column.key] ?? null]),
          ),
        ),
      );
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: columns.length },
      };
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF087F84' },
      };
      columns.forEach((column, index) => {
        if (column.format !== 'text')
          sheet.getColumn(index + 1).numFmt =
            column.format === 'percent'
              ? '0.00"%"'
              : column.format === 'money'
                ? '#,##0.00;[Red]-#,##0.00'
                : '#,##0.######';
      });
    };
    addSheet(
      'Consolidado',
      reportColumns({ ...data.filters, view: 'summary' }),
      data.summary,
    );
    addSheet(
      'Registros',
      reportColumns({ ...data.filters, view: 'detail' }),
      data.detail,
    );
    const totalColumns: ReportColumn[] = [
      { key: 'currency', label: 'Moneda', format: 'text' },
      ...[
        'grossSales',
        'creditNotes',
        'debitNotes',
        'netSales',
        'discount',
        'ivaGenerated',
        'iva',
        'otherTaxes',
        'retefuente',
        'reteIca',
        'reteIva',
        'retentionsSuffered',
        'retentionsPracticed',
        'total',
        'payable',
      ].map((key, index) => ({
        key,
        label: [
          'Ventas brutas',
          'Notas crédito (negativas)',
          'Notas débito',
          'Ventas netas',
          'Descuento posterior a impuestos',
          'IVA generado neto en ventas',
          'IVA neto de todos los documentos',
          'Otros impuestos',
          'Retefuente neta',
          'ReteICA neta',
          'ReteIVA neta',
          'Retenciones que nos practicaron',
          'Retenciones practicadas',
          'Valor total',
          'Valor después de retenciones',
        ][index],
        format: 'money' as const,
      })),
      ...['invoiceCount', 'creditCount', 'debitCount'].map((key, index) => ({
        key,
        label: ['Facturas', 'Notas crédito / ajuste', 'Notas débito'][index],
        format: 'number' as const,
      })),
      ...(data.filters.report === 'products'
        ? [
            'soldQuantity',
            'returnedQuantity',
            'debitQuantity',
            'netQuantity',
          ].map((key, index) => ({
            key,
            label: [
              'Cantidad vendida',
              'Cantidad devuelta',
              'Cantidad notas débito',
              'Cantidad neta',
            ][index],
            format: 'number' as const,
          }))
        : []),
    ];
    addSheet('Totales', totalColumns, data.totals);
    const metadata = book.addWorksheet('Filtros y criterios');
    metadata.columns = [
      { header: 'Filtro / criterio', key: 'key', width: 35 },
      { header: 'Valor', key: 'value', width: 120 },
    ];
    const reportLabels = {
      sales: 'Ventas generales',
      customers: 'Ventas por cliente',
      products: 'Ventas por producto',
      sellers: 'Ventas por vendedor',
      taxes: 'Impuestos y retenciones',
    };
    const kindLabels: Record<string, string> = {
      ELECTRONIC_INVOICE: 'Factura de venta',
      CREDIT_NOTE: 'Nota crédito',
      DEBIT_NOTE: 'Nota débito',
      SUPPORT_DOCUMENT: 'Documento soporte',
      SUPPORT_CREDIT_NOTE: 'Nota de ajuste',
    };
    const filterLabels = {
      report: 'Reporte',
      view: 'Vista consultada',
      from: 'Desde',
      to: 'Hasta',
      customer: 'Cliente / proveedor',
      seller: 'Vendedor',
      product: 'Producto o servicio',
      kind: 'Tipo de comprobante',
      currency: 'Moneda',
    };
    (
      Object.entries(filterLabels) as Array<[keyof typeof filterLabels, string]>
    ).forEach(([key, label]) => {
      const value =
        key === 'report'
          ? reportLabels[data.filters.report]
          : key === 'view'
            ? data.filters.view === 'detail'
              ? 'Registros individuales'
              : 'Consolidado'
            : key === 'kind'
              ? kindLabels[data.filters.kind] || 'Todos'
              : data.filters[key] || 'Todos';
      metadata.addRow({ key: label, value });
    });
    data.warnings.forEach((value) =>
      metadata.addRow({ key: 'Criterio / observación', value }),
    );
    return {
      buffer: Buffer.from(await book.xlsx.writeBuffer()),
      filename: `JARVIS-${data.filters.report}-${data.filters.from}-${data.filters.to}.xlsx`,
    };
  }
}
