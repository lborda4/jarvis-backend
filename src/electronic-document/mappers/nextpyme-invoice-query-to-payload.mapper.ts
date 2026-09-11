import { NextPymeInvoiceQueryResult } from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

function toNumber(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  // Redondea a centavos: NextPyme/DIAN a veces trae valores calculados con
  // residuo de punto flotante (ej. 3564706.3499999996), que SIIGO rechaza
  // más adelante por tener más de 2 decimales.
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

// Códigos DIAN de tipo de documento de identificación (tabla 5.7 UBL 2.1).
const DIAN_DOCUMENT_TYPE_BY_CODE: Record<string, string> = {
  '13': 'CC', // Cédula de ciudadanía
  '21': 'CE', // Tarjeta de extranjería
  '22': 'CE', // Cédula de extranjería
  '31': 'NIT',
  '41': 'PA', // Pasaporte
  '42': 'PA', // Documento de identificación extranjero
};

function resolveDocumentType(
  typeIdentification: string | number | undefined,
): string {
  const normalized = String(typeIdentification ?? '').trim();

  return DIAN_DOCUMENT_TYPE_BY_CODE[normalized] ?? 'NIT';
}

/**
 * NextPyme devuelve el departamento y el municipio como códigos separados
 * (`municipality.department.code` de 2 dígitos, `municipality.code` de 3) —
 * el código DIVIPOLA completo que espera SIIGO en `address.city.city_code`
 * es la concatenación de ambos, con cero a la izquierda (ej. departamento
 * "5" + municipio "149" -> "05149", no "149" solo). Bug real reportado: se
 * mandaba `municipality.code` tal cual (sin el departamento) y el
 * departamento sin rellenar, y SIIGO rechazaba la ciudad con
 * invalid_reference porque "Co|5|149" no es un código DIVIPOLA válido.
 */
function buildDivipolaCityCode(
  departmentCode: string | undefined,
  municipalityCode: string | undefined,
): string {
  const department = departmentCode?.trim();
  const municipality = municipalityCode?.trim();

  if (!department || !municipality) {
    return municipality || '';
  }

  return `${department.padStart(2, '0')}${municipality.padStart(3, '0')}`;
}

// DIAN tabla 9.5 (forma de pago): 1 = Contado, 2 = Crédito.
/**
 * NextPyme manda "0001-01-01" como payment_due_date en facturas sin fecha
 * de vencimiento real (ej. Contado) — es el valor por defecto de un
 * DateTime sin inicializar de su lado (.NET DateTime.MinValue), no una
 * fecha real. Guardarlo tal cual como `dueDate` producía un bug real
 * reportado: el frontend calculaba "Plazo" como issueDate - dueDate, y
 * `Date.UTC(1, 0, 1)` en JS interpreta años de 0-99 como "1900 + año"
 * (quirk histórico del motor) — año 1 se convertía en 1901, dando un Plazo
 * de -45744 días en vez de simplemente no tener dato. Cualquier año < 1900
 * se descarta acá mismo, en el origen, en vez de confiar en que cada
 * consumidor lo filtre por su cuenta.
 */
function isPlausibleInvoiceDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) && year >= 1900;
}

function resolveIsCreditPayment(
  paymentFormId: string | number | undefined,
): boolean | undefined {
  const normalized = String(paymentFormId ?? '').trim();

  if (normalized === '1') {
    return false;
  }

  if (normalized === '2') {
    return true;
  }

  return undefined;
}

export function mapNextPymeInvoiceQueryToElectronicDocumentPayload(
  result: NextPymeInvoiceQueryResult,
  cufe: string,
): ElectronicDocumentPayload {
  const seller = result.seller;
  const totals = result.legal_monetary_totals;
  const lineExtension = toNumber(totals.line_extension_amount);
  const taxExclusive = toNumber(totals.tax_exclusive_amount);
  const taxInclusive = toNumber(totals.tax_inclusive_amount);
  const payable = toNumber(totals.payable_amount);
  // Descuento general a nivel de documento (no atribuible a una línea
  // puntual) — SIIGO ya lo tiene restado en payable_amount, pero antes de
  // este fix se perdía por completo: no llegaba a ningún lado del payload,
  // así que el resumen que arma el frontend (Subtotal + IVA − Retenciones)
  // no tenía cómo saber que existía y el "Total neto" mostrado ignoraba el
  // descuento.
  const discount = toNumber(totals.allowance_total_amount);
  // El Subtotal es tax_exclusive_amount (el campo certificado por la DIAN
  // para la base gravable) — line_extension_amount y payable_amount solo se
  // usan como respaldo cuando tax_exclusive_amount viene en 0 (ej. facturas
  // sin IVA de algunos proveedores, donde ese campo no se diligencia).
  const subtotal =
    taxExclusive > 0
      ? taxExclusive
      : lineExtension > 0
        ? lineExtension
        : payable;
  // El IVA sale de la suma de tax_totals a nivel de factura (no por línea,
  // para no duplicar cuando hay varias líneas) — es el dato certificado por
  // la DIAN. Si el proveedor no lo envía, se cae al cálculo anterior
  // (tax_inclusive - tax_exclusive) como respaldo: no se usa payable - subtotal
  // porque payable ya tiene el descuento general restado, y esa resta se
  // "comía" el descuento como si fuera parte del IVA.
  const invoiceTaxTotals = result.tax_totals ?? [];
  const taxTotalsSum = invoiceTaxTotals.reduce(
    (sum, tax) => sum + toNumber(tax.tax_amount),
    0,
  );
  const iva =
    invoiceTaxTotals.length > 0
      ? taxTotalsSum
      : taxExclusive > 0 && taxInclusive > taxExclusive
        ? taxInclusive - taxExclusive
        : Math.max(payable + discount - subtotal, 0);
  // Retenciones sugeridas por el vendedor, certificadas en la factura DIAN
  // (ver comentario en NextPymeInvoiceQueryResult.with_holding_tax_totals) —
  // se descartan entradas sin tax_code o con porcentaje 0/inválido, nunca se
  // adivina el código.
  const withholdings = (result.with_holding_tax_totals ?? [])
    .map((tax) => ({
      dianTaxCode: String(tax.tax_code ?? '').trim(),
      percentage: toNumber(tax.percent),
    }))
    .filter((tax) => tax.dianTaxCode && tax.percentage > 0);

  const invoiceNumber =
    `${result.prefix ?? ''}${result.number ?? ''}`.trim() || cufe.slice(0, 12);
  const isCreditPayment = resolveIsCreditPayment(
    result.payment_form?.payment_form_id,
  );
  const durationMeasure = toNumber(result.payment_form?.duration_measure);

  const items = result.invoice_lines.length
    ? result.invoice_lines.map((line) => {
        const quantity = toNumber(line.invoiced_quantity);
        const price = toNumber(line.price_amount);
        const total = toNumber(line.line_extension_amount);
        // Se toma el primer impuesto de la línea como IVA — en Documento
        // Soporte/Factura de compra las retenciones no vienen por ítem acá.
        const firstTax = line.tax_totals?.[0];
        const ivaPercentage =
          firstTax?.percent !== undefined
            ? toNumber(firstTax.percent)
            : undefined;
        // Descuento propio de la línea (allowance_charges). Un descuento
        // general a nivel de documento, no atribuible a una línea puntual,
        // no se reparte acá — se deja tal cual viene por línea.
        const discount = (line.allowance_charges ?? []).reduce(
          (sum, charge) => sum + toNumber(charge.amount),
          0,
        );

        return {
          descripcion: line.description?.trim() || 'Ítem importado',
          cantidad: quantity > 0 ? quantity : 1,
          valorUnitario: price > 0 ? price : total,
          total: total > 0 ? total : price,
          ...(line.code?.trim() ? { codigo: line.code.trim() } : {}),
          ...(ivaPercentage !== undefined ? { ivaPercentage } : {}),
          ...(discount > 0 ? { discount } : {}),
        };
      })
    : [
        {
          descripcion: 'Factura electrónica recibida',
          cantidad: 1,
          valorUnitario: subtotal,
          total: subtotal,
        },
      ];

  return {
    supplier: {
      documentNumber: String(seller.identification_number ?? '').replace(
        /\D/g,
        '',
      ),
      documentType: resolveDocumentType(seller.type_identification),
      name: seller.name?.trim() || '',
      commercialName: seller.name?.trim() || '',
      address: seller.address?.trim() || '',
      phone: seller.phone?.trim() || '',
      email: seller.email?.trim() || '',
      stateCode:
        seller.municipality?.department?.code?.trim().padStart(2, '0') || '',
      cityCode:
        buildDivipolaCityCode(
          seller.municipality?.department?.code,
          seller.municipality?.code,
        ) ||
        seller.code?.trim() ||
        '',
      countryCode: 'Co',
    },
    invoice: {
      cufe,
      prefix: result.prefix?.trim() || undefined,
      number: invoiceNumber,
      issueDate: result.date?.trim() || '',
      ...(result.payment_form?.payment_due_date?.trim() &&
      isPlausibleInvoiceDate(result.payment_form.payment_due_date.trim())
        ? { dueDate: result.payment_form.payment_due_date.trim() }
        : {}),
      ...(isCreditPayment !== undefined ? { isCreditPayment } : {}),
      ...(durationMeasure > 0 ? { durationMeasure } : {}),
      currency: 'COP',
    },
    items,
    taxes: iva > 0 ? [{ type: 'IVA', amount: iva }] : [],
    totals: {
      subtotal,
      total: payable,
      iva,
      ...(discount > 0 ? { discount } : {}),
    },
    ...(result.notes?.trim() ? { observations: result.notes.trim() } : {}),
    ...(withholdings.length > 0 ? { withholdings } : {}),
  };
}
