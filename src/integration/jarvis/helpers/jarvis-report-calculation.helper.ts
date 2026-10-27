import type { CreateJarvisInvoiceRequestDto } from '../dto/create-jarvis-invoice.dto';
import type {
  ReportColumn,
  ReportDocument,
  ReportFilters,
  ReportRow,
} from '../jarvis-reports.types';
import { calculateJarvisRetention } from './jarvis-tax-calculation.helper';

const amountKeys = [
  'subtotal',
  'discount',
  'netSales',
  'iva',
  'otherTaxes',
  'retefuente',
  'reteIca',
  'reteIva',
  'total',
  'payable',
] as const;
type AmountKey = (typeof amountKeys)[number];
type Amounts = Record<AmountKey, number | null>;
type Seller = { id: string; name: string };
interface Detail extends Amounts {
  id: string;
  kind: string;
  date: string;
  number: string;
  customerId: string;
  customerName: string;
  customerType: string;
  currency: string;
  seller: string;
  sellerId: string;
  direction: string;
  productCode: string;
  productName: string;
  quantity: number | null;
  unitValue: number | null;
}
const labels: Record<string, string> = {
  ELECTRONIC_INVOICE: 'Factura de venta',
  CREDIT_NOTE: 'Nota crédito',
  DEBIT_NOTE: 'Nota débito',
  SUPPORT_DOCUMENT: 'Documento soporte',
  SUPPORT_CREDIT_NOTE: 'Nota de ajuste',
};
const isPurchase = (kind: string) =>
  kind === 'SUPPORT_DOCUMENT' || kind === 'SUPPORT_CREDIT_NOTE';
const isCredit = (kind: string) =>
  kind === 'CREDIT_NOTE' || kind === 'SUPPORT_CREDIT_NOTE';
const cents = (value: number | string | undefined) =>
  Math.round((Number(value ?? 0) + Number.EPSILON) * 100);
const money = (value: number | null) => (value === null ? null : value / 100);
const matches = (value: string, filter: string) =>
  value.toLocaleLowerCase('es').includes(filter.toLocaleLowerCase('es'));
const sum = (rows: Amounts[], key: AmountKey): number | null =>
  rows.some((row) => row[key] === null)
    ? null
    : rows.reduce((total, row) => total + (row[key] ?? 0), 0);
const add = (...values: Array<number | null>): number | null =>
  values.some((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** Reparto en centavos: conserva exactamente el total aun con redondeos. */
export function allocateReportAmount(
  total: number,
  weights: number[],
): number[] {
  const positive = weights.map((value) => Math.max(0, value));
  const denominator = positive.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  let previous = 0;
  return positive.map((value, index) => {
    cumulative += denominator ? value : 1;
    const next =
      index === positive.length - 1
        ? total
        : Math.round((total * cumulative) / (denominator || positive.length));
    const share = next - previous;
    previous = next;
    return share;
  });
}

function retentionKey(
  type = '',
  id?: number,
): 'retefuente' | 'reteIca' | 'reteIva' | null {
  const key = type.toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'reteiva' || (!key && id === 5)) return 'reteIva';
  if (key === 'reteica' || (!key && id === 7)) return 'reteIca';
  if (
    ['retefuente', 'reterenta', 'retencionenlafuente'].includes(key) ||
    (!key && id === 6)
  )
    return 'retefuente';
  return null;
}
function retentionCents(
  retention: NonNullable<CreateJarvisInvoiceRequestDto['retentions']>[number],
  base: number,
  iva: number,
) {
  const key = retentionKey(retention.type, retention.id);
  const type =
    key === 'reteIca' ? 'ReteICA' : key === 'reteIva' ? 'ReteIVA' : 'ReteRenta';
  return {
    key,
    value: cents(
      calculateJarvisRetention(
        type,
        Number(retention.percentage ?? 0),
        base / 100,
        iva / 100,
      ).amount,
    ),
  };
}

function calculateLines(
  document: ReportDocument,
  warnings: Set<string>,
): Amounts[] | null {
  const request = document.source;
  if (!request?.items?.length) return null;
  const lines = request.items;
  if (
    !Number.isFinite(Number(request.discountAmount ?? 0)) ||
    lines.some((line) =>
      [
        line.quantity,
        line.unitValue,
        line.discount ?? 0,
        line.taxAmount ?? 0,
      ].some((value) => !Number.isFinite(Number(value))),
    )
  )
    return null;
  const bases = lines.map((line) =>
    cents(
      Number(line.quantity) * Number(line.unitValue) -
        Number(line.discount ?? 0),
    ),
  );
  const discount = cents(request.discountAmount);
  const allowances = allocateReportAmount(discount, bases);
  const charges = lines.map((line) => cents(line.taxAmount));
  const subtotal =
    bases.reduce((a, b) => a + b, 0) -
    (document.kind === 'DEBIT_NOTE' ? 0 : discount);
  const global: Record<'retefuente' | 'reteIca' | 'reteIva', number[]> = {
    retefuente: lines.map(() => 0),
    reteIca: lines.map(() => 0),
    reteIva: lines.map(() => 0),
  };
  for (const retention of request.retentions ?? []) {
    const { key, value } = retentionCents(
      retention,
      subtotal,
      charges.reduce((a, b) => a + b, 0),
    );
    if (!key) {
      warnings.add(
        'Hay retenciones sin clasificación reconocida; no se atribuyen a retefuente, reteICA ni reteIVA.',
      );
      continue;
    }
    const shares = allocateReportAmount(
      value,
      key === 'reteIva' ? charges : bases,
    );
    shares.forEach((share, index) => {
      global[key][index] += share;
    });
  }
  const result: Amounts[] = lines.map((line, index) => {
    const base =
      bases[index] - (document.kind === 'DEBIT_NOTE' ? 0 : allowances[index]);
    const amounts: Amounts = {
      subtotal: base,
      discount: document.kind === 'DEBIT_NOTE' ? allowances[index] : 0,
      netSales: base - (document.kind === 'DEBIT_NOTE' ? allowances[index] : 0),
      iva: (line.taxId ?? 1) === 1 ? charges[index] : 0,
      otherTaxes: (line.taxId ?? 1) === 1 ? 0 : charges[index],
      retefuente: global.retefuente[index],
      reteIca: global.reteIca[index],
      reteIva: global.reteIva[index],
      total: 0,
      payable: 0,
    };
    if (line.retention) {
      const { key, value } = retentionCents(
        line.retention,
        bases[index],
        charges[index],
      );
      if (key) amounts[key] = (amounts[key] ?? 0) + value;
      else
        warnings.add(
          'Hay retenciones sin clasificación reconocida; no se atribuyen a retefuente, reteICA ni reteIVA.',
        );
    }
    amounts.total =
      base +
      charges[index] -
      (document.kind === 'DEBIT_NOTE' ? allowances[index] : 0);
    return amounts;
  });
  const difference =
    cents(document.total) -
    result.reduce((total, line) => total + (line.total ?? 0), 0);
  if (Math.abs(difference) > 1)
    warnings.add(
      'Algunos comprobantes difieren de su desglose conservado. Se mantiene su total registrado y se distribuye la diferencia proporcionalmente entre las líneas.',
    );
  const corrections = allocateReportAmount(difference, bases);
  result.forEach((line, index) => {
    line.total = (line.total ?? 0) + corrections[index];
    line.payable =
      line.total -
      (line.retefuente ?? 0) -
      (line.reteIca ?? 0) -
      (line.reteIva ?? 0);
  });
  return result;
}

function sellersFor(document: ReportDocument): Seller[] {
  const source = document.source?.sellers?.length
    ? document.source.sellers
    : (document.referenceSellers ?? []);
  return [
    ...new Map(
      source
        .filter((seller) => seller.id && seller.name)
        .map((seller) => [seller.id, seller]),
    ).values(),
  ];
}
const numericColumns: ReportColumn[] = [
  { key: 'subtotal', label: 'Subtotal', format: 'money' },
  {
    key: 'discount',
    label: 'Descuento posterior a impuestos',
    format: 'money',
  },
  { key: 'netSales', label: 'Valor neto antes de impuestos', format: 'money' },
  { key: 'iva', label: 'IVA', format: 'money' },
  { key: 'otherTaxes', label: 'Otros impuestos', format: 'money' },
  { key: 'retefuente', label: 'Retefuente', format: 'money' },
  { key: 'reteIca', label: 'ReteICA', format: 'money' },
  { key: 'reteIva', label: 'ReteIVA', format: 'money' },
  { key: 'total', label: 'Valor total', format: 'money' },
  { key: 'payable', label: 'Valor después de retenciones', format: 'money' },
];
const col = (
  key: string,
  label: string,
  format: ReportColumn['format'] = 'text',
): ReportColumn => ({ key, label, format });
export function reportColumns(filters: ReportFilters): ReportColumn[] {
  const common = [col('currency', 'Moneda'), ...numericColumns];
  if (filters.view === 'detail')
    return [
      col('date', 'Fecha de emisión'),
      col('kind', 'Tipo de comprobante'),
      col('number', 'Número de comprobante'),
      col('customerType', 'Tipo de identificación'),
      col('customerId', 'Identificación cliente / proveedor'),
      col('customerName', 'Cliente / proveedor'),
      ...(filters.report === 'products'
        ? [
            col('productCode', 'Código'),
            col('productName', 'Producto o servicio'),
            col('quantity', 'Cantidad', 'number'),
            col('unitValue', 'Valor unitario', 'money'),
          ]
        : []),
      col('seller', 'Vendedor'),
      col('direction', 'Retenciones'),
      ...common,
    ];
  const groups: Record<string, ReportColumn[]> = {
    sales: [col('kind', 'Tipo de comprobante')],
    customers: [
      col('customerType', 'Tipo de identificación'),
      col('customerId', 'Identificación'),
      col('customerName', 'Cliente'),
    ],
    products: [
      col('productCode', 'Código'),
      col('productName', 'Producto o servicio'),
      col('soldQuantity', 'Cantidad vendida', 'number'),
      col('returnedQuantity', 'Cantidad devuelta', 'number'),
      col('debitQuantity', 'Cantidad notas débito', 'number'),
      col('netQuantity', 'Cantidad neta', 'number'),
    ],
    sellers: [
      col('seller', 'Vendedor'),
      col('participation', 'Participación en ventas netas (%)', 'percent'),
    ],
    taxes: [
      col('direction', 'Retenciones'),
      col('kind', 'Tipo de comprobante'),
    ],
  };
  return [
    ...groups[filters.report],
    col('invoiceCount', 'Facturas', 'number'),
    col('creditCount', 'Notas crédito / ajuste', 'number'),
    col('debitCount', 'Notas débito', 'number'),
    ...common,
  ];
}
function publicRow(row: Detail): ReportRow {
  return {
    ...row,
    kind: labels[row.kind] ?? row.kind,
    ...Object.fromEntries(
      amountKeys.map((key) => [key, money(row[key])] as const),
    ),
    unitValue: money(row.unitValue),
  };
}
function aggregate(rows: Detail[]): ReportRow {
  return {
    ...Object.fromEntries(
      amountKeys.map((key) => [key, money(sum(rows, key))] as const),
    ),
    currency: rows[0].currency,
    invoiceCount: new Set(
      rows
        .filter((row) => row.kind === 'ELECTRONIC_INVOICE')
        .map((row) => row.id),
    ).size,
    creditCount: new Set(
      rows.filter((row) => isCredit(row.kind)).map((row) => row.id),
    ).size,
    debitCount: new Set(
      rows.filter((row) => row.kind === 'DEBIT_NOTE').map((row) => row.id),
    ).size,
  };
}
function quantities(rows: Detail[]): ReportRow {
  const quantity = (subset: Detail[]) =>
    Number(
      subset.reduce((total, row) => total + (row.quantity ?? 0), 0).toFixed(6),
    );
  return {
    soldQuantity: quantity(
      rows.filter((row) => row.kind === 'ELECTRONIC_INVOICE'),
    ),
    returnedQuantity: -quantity(
      rows.filter((row) => row.kind === 'CREDIT_NOTE'),
    ),
    debitQuantity: quantity(rows.filter((row) => row.kind === 'DEBIT_NOTE')),
    netQuantity: quantity(rows),
  };
}

export function calculateJarvisReport(
  documents: ReportDocument[],
  filters: ReportFilters,
) {
  const warnings = new Set<string>();
  const records: Detail[] = [];
  let missingDetail = 0;
  for (const document of documents) {
    if (filters.report !== 'taxes' && isPurchase(document.kind)) continue;
    const sellers = sellersFor(document);
    const matchedSellers = sellers.filter((seller) =>
      matches(seller.name + ' ' + seller.id, filters.seller),
    );
    if (filters.seller && !matchedSellers.length) continue;
    const calculated = calculateLines(document, warnings);
    if (!calculated) missingDetail++;
    const allLines = document.source?.items ?? [];
    const selectedIndexes = allLines.flatMap((line, index) =>
      matches((line.code ?? '') + ' ' + line.description, filters.product)
        ? [index]
        : [],
    );
    if (filters.product && (!calculated || !selectedIndexes.length)) continue;
    const base = {
      id: document.id,
      kind: document.kind,
      date: document.date,
      number: document.number,
      customerId: document.customerId,
      customerName: document.customerName,
      customerType: document.source?.customerDocumentType ?? '',
      currency: document.currency,
      seller:
        sellers.map((seller) => seller.name).join(', ') ||
        'Sin vendedor registrado',
      sellerId: sellers.map((seller) => seller.id).join(','),
      direction: isPurchase(document.kind)
        ? 'Practicadas por nosotros'
        : 'Nos practicaron',
      productCode: '',
      productName: '',
      quantity: null,
      unitValue: null,
    };
    const sign = isCredit(document.kind) ? -1 : 1;
    const signed = (amounts: Amounts): Amounts =>
      Object.fromEntries(
        amountKeys.map((key) => [
          key,
          amounts[key] === null ? null : sign * amounts[key],
        ]),
      ) as Amounts;
    if (filters.report === 'products') {
      if (!calculated) continue;
      selectedIndexes.forEach((index) =>
        records.push({
          ...base,
          ...signed(calculated[index]),
          productCode: allLines[index].code ?? '',
          productName: allLines[index].description,
          quantity: sign * Number(allLines[index].quantity),
          unitValue: cents(allLines[index].unitValue),
        }),
      );
      continue;
    }
    const amounts: Amounts = calculated
      ? (Object.fromEntries(
          amountKeys.map((key) => [
            key,
            sum(
              (filters.product
                ? selectedIndexes
                : calculated.map((_, index) => index)
              ).map((index) => calculated[index]),
              key,
            ),
          ]),
        ) as Amounts)
      : {
          subtotal: null,
          discount: null,
          netSales: null,
          iva: null,
          otherTaxes: null,
          retefuente: null,
          reteIca: null,
          reteIva: null,
          total: cents(document.total),
          payable: null,
        };
    if (filters.report === 'sellers') {
      const allocation = sellers.length
        ? sellers
        : [{ id: '', name: 'Sin vendedor registrado' }];
      if (sellers.length > 1)
        warnings.add(
          'Los comprobantes con varios vendedores se reparten en partes iguales porque no tienen porcentajes de atribución registrados. El filtro de vendedor conserva solo su parte.',
        );
      const shares = Object.fromEntries(
        amountKeys.map((key) => [
          key,
          amounts[key] === null
            ? allocation.map(() => null)
            : allocateReportAmount(
                amounts[key],
                allocation.map(() => 1),
              ),
        ]),
      ) as Record<AmountKey, Array<number | null>>;
      allocation.forEach((seller, index) => {
        if (
          filters.seller &&
          !matchedSellers.some((match) => match.id === seller.id)
        )
          return;
        records.push({
          ...base,
          ...signed(
            Object.fromEntries(
              amountKeys.map((key) => [key, shares[key][index]]),
            ) as Amounts,
          ),
          seller: seller.name,
          sellerId: seller.id,
        });
      });
    } else records.push({ ...base, ...signed(amounts) });
  }
  if (missingDetail)
    warnings.add(
      `${missingDetail} comprobantes no conservan desglose suficiente. Sus totales registrados se incluyen cuando corresponde; subtotales e impuestos desconocidos se muestran sin dato. No se inventan productos ni valores.`,
    );
  if (filters.product)
    warnings.add(
      'Con filtro de producto, los importes corresponden solo a sus líneas. Los descuentos y retenciones generales se distribuyen proporcionalmente, conservando los centavos del comprobante.',
    );
  const groups = new Map<string, Detail[]>();
  for (const row of records) {
    const key = JSON.stringify([
      row.currency,
      filters.report === 'sales'
        ? row.kind
        : filters.report === 'customers'
          ? [row.customerType, row.customerId]
          : filters.report === 'products'
            ? row.productCode || row.productName
            : filters.report === 'sellers'
              ? row.sellerId
              : [row.direction, row.kind],
    ]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const summary: ReportRow[] = [...groups.values()].map((rows) => {
    const first = rows[0];
    const result: ReportRow = {
      ...aggregate(rows),
      kind: labels[first.kind],
      customerType: first.customerType,
      customerId: first.customerId,
      customerName: first.customerName,
      productCode: first.productCode,
      productName: first.productName,
      seller: first.seller,
      direction: first.direction,
    };
    if (filters.report === 'products') Object.assign(result, quantities(rows));
    return result;
  });
  if (filters.report === 'sellers')
    summary.forEach((row) => {
      const currencyRows = summary.filter(
        (other) => other.currency === row.currency,
      );
      const net = currencyRows.every((other) => other.netSales !== null)
        ? currencyRows.reduce(
            (total, other) => total + Number(other.netSales),
            0,
          )
        : null;
      row.participation =
        net && row.netSales !== null
          ? Number(((Number(row.netSales) / net) * 100).toFixed(4))
          : null;
    });
  const currencies = [...new Set(records.map((row) => row.currency))];
  const totals = currencies.map((currency) => {
    const rows = records.filter((row) => row.currency === currency);
    const sales = rows.filter((row) => !isPurchase(row.kind));
    const invoices = sales.filter((row) => row.kind === 'ELECTRONIC_INVOICE');
    const credits = sales.filter((row) => row.kind === 'CREDIT_NOTE');
    const debits = sales.filter((row) => row.kind === 'DEBIT_NOTE');
    const retentions = (subset: Detail[]) =>
      add(
        sum(subset, 'retefuente'),
        sum(subset, 'reteIca'),
        sum(subset, 'reteIva'),
      );
    return {
      ...aggregate(rows),
      ...(filters.report === 'products' ? quantities(rows) : {}),
      grossSales: money(sum(invoices, 'subtotal')),
      creditNotes: money(sum(credits, 'netSales')),
      debitNotes: money(sum(debits, 'netSales')),
      netSales: money(sum(sales, 'netSales')),
      ivaGenerated: money(sum(sales, 'iva')),
      retentionsSuffered: money(retentions(sales)),
      retentionsPracticed: money(
        retentions(rows.filter((row) => isPurchase(row.kind))),
      ),
    };
  });
  const detail = records.map(publicRow);
  return { detail, summary, totals, warnings: [...warnings] };
}
