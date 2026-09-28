import {
  NextPymeInvoiceQueryParty,
  NextPymeInvoiceQueryLineTax,
  NextPymeInvoiceQueryResult,
} from '../../integration/jarvis/nextpyme/nextpyme-api.client';
import { resolveCountryName } from '../helpers/dian-location.helper';
import {
  ElectronicDocumentPayload,
  ElectronicDocumentSupplier,
} from '../interfaces/electronic-document-payload.interface';

function resolveTaxType(tax: NextPymeInvoiceQueryLineTax): string {
  const code = tax.tax_code?.trim();
  if (code) {
    return code === '04' ? 'INC' : code === '01' ? 'IVA' : code;
  }
  // Compatibilidad con respuestas anteriores sin tax_code/tax_name.
  return tax.tax_name?.trim().toUpperCase() || 'IVA';
}

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

function addDaysToIsoDate(date: string, days: number): string | null {
  if (!isPlausibleInvoiceDate(date) || !Number.isFinite(days) || days <= 0) {
    return null;
  }

  const [year, month, day] = date.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day + Math.trunc(days));

  if (!Number.isFinite(utc)) {
    return null;
  }

  return new Date(utc).toISOString().slice(0, 10);
}

function resolveInvoiceDueDate(
  paymentDueDate: string | undefined,
  issueDate: string,
  durationMeasure: number,
): string | undefined {
  const trimmedDueDate = paymentDueDate?.trim();

  if (trimmedDueDate && isPlausibleInvoiceDate(trimmedDueDate)) {
    return trimmedDueDate;
  }

  return addDaysToIsoDate(issueDate, durationMeasure) ?? undefined;
}

function isChargeIndicator(
  value: string | boolean | undefined,
): boolean {
  return value === true || value === 'true' || value === '1';
}

function mapParty(
  party: NextPymeInvoiceQueryParty | undefined,
  fallbackDocumentType: string,
): ElectronicDocumentSupplier | undefined {
  if (!party) {
    return undefined;
  }

  const documentNumber = String(party.identification_number ?? '').replace(
    /\D/g,
    '',
  );
  const name = party.name?.trim() || '';

  if (!documentNumber && !name) {
    return undefined;
  }

  const stateName =
    party.municipality?.department?.name?.trim() ||
    party.department?.trim() ||
    '';
  const cityName =
    party.municipality?.name?.trim() || party.city?.trim() || '';

  return {
    documentNumber,
    documentType: resolveDocumentType(party.type_identification) || fallbackDocumentType,
    name,
    commercialName: name,
    address: party.address?.trim() || '',
    phone: party.phone?.trim() || '',
    email: party.email?.trim() || '',
    stateName,
    cityName,
    countryCode: 'Co',
    countryName: resolveCountryName('Co') ?? 'Colombia',
    stateCode:
      party.municipality?.department?.code?.trim().padStart(2, '0') || '',
    cityCode:
      buildDivipolaCityCode(
        party.municipality?.department?.code,
        party.municipality?.code,
      ) ||
      party.code?.trim() ||
      '',
  };
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
  // El IVA sale de sus entradas en tax_totals a nivel de factura (no por línea,
  // para no duplicar cuando hay varias líneas) — es el dato certificado por
  // la DIAN. Si el proveedor no lo envía, se cae al cálculo anterior
  // (tax_inclusive - tax_exclusive) como respaldo: no se usa payable - subtotal
  // porque payable ya tiene el descuento general restado, y esa resta se
  // "comía" el descuento como si fuera parte del IVA.
  const invoiceTaxTotals = result.tax_totals ?? [];
  const taxesByType = new Map<string, number>();
  for (const tax of invoiceTaxTotals) {
    const type = resolveTaxType(tax);
    taxesByType.set(
      type,
      (taxesByType.get(type) ?? 0) + toNumber(tax.tax_amount),
    );
  }
  const iva =
    invoiceTaxTotals.length > 0
      ? toNumber(taxesByType.get('IVA'))
      : taxExclusive > 0 && taxInclusive > taxExclusive
        ? taxInclusive - taxExclusive
        : Math.max(payable + discount - subtotal, 0);
  // Retenciones sugeridas por el vendedor, certificadas en la factura DIAN
  // (ver comentario en NextPymeInvoiceQueryResult.with_holding_tax_totals) —
  // se descartan entradas sin tax_code o con porcentaje 0/inválido, nunca se
  // adivina el código.
  const withholdings = (result.with_holding_tax_totals ?? [])
    .map((tax) => {
      const amount = toNumber(tax.tax_amount ?? tax.amount);

      return {
        dianTaxCode: String(tax.tax_code ?? '').trim(),
        percentage: toNumber(tax.percent),
        ...(amount > 0 ? { amount } : {}),
      };
    })
    .filter((tax) => tax.dianTaxCode && tax.percentage > 0);

  const invoiceNumber =
    `${result.prefix ?? ''}${result.number ?? ''}`.trim() || cufe.slice(0, 12);
  const paymentMethodCode = String(
    result.payment_form?.payment_method_id ?? '',
  ).trim();
  const isCreditPayment = resolveIsCreditPayment(
    result.payment_form?.payment_form_id,
  );
  const supplier =
    mapParty(seller, 'NIT') ??
    ({
      documentNumber: '',
      documentType: 'NIT',
      name: '',
    } satisfies ElectronicDocumentSupplier);
  const buyer = mapParty(result.customer, 'NIT');
  const globalSurcharge = toNumber(totals.charge_total_amount);
  const durationMeasure = toNumber(result.payment_form?.duration_measure);
  const dueDate = resolveInvoiceDueDate(
    result.payment_form?.payment_due_date,
    result.date?.trim() || '',
    durationMeasure,
  );

  const items = result.invoice_lines.length
    ? result.invoice_lines.map((line) => {
        const quantity = toNumber(line.invoiced_quantity);
        const price = toNumber(line.price_amount);
        const total = toNumber(line.line_extension_amount);
        // INC puede aparecer antes del IVA o ser el único impuesto de la línea.
        const firstTax = line.tax_totals?.find(
          (tax) => resolveTaxType(tax) === 'IVA',
        );
        const ivaPercentage =
          firstTax?.percent !== undefined
            ? toNumber(firstTax.percent)
            : undefined;
        const lineCharges = line.allowance_charges ?? [];
        const discount = lineCharges.reduce((sum, charge) => {
          return isChargeIndicator(charge.charge_indicator)
            ? sum
            : sum + toNumber(charge.amount);
        }, 0);
        const surcharge = lineCharges.reduce((sum, charge) => {
          return isChargeIndicator(charge.charge_indicator)
            ? sum + toNumber(charge.amount)
            : sum;
        }, 0);

        return {
          descripcion: line.description?.trim() || 'Ítem importado',
          cantidad: quantity > 0 ? quantity : 1,
          valorUnitario: price > 0 ? price : total,
          total: total > 0 ? total : price,
          ...(line.code?.trim() ? { codigo: line.code.trim() } : {}),
          ...(ivaPercentage !== undefined ? { ivaPercentage } : {}),
          ...(discount > 0 ? { discount } : {}),
          ...(surcharge > 0 ? { surcharge } : {}),
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
    supplier,
    ...(buyer ? { buyer } : {}),
    invoice: {
      cufe,
      prefix: result.prefix?.trim() || undefined,
      number: invoiceNumber,
      issueDate: result.date?.trim() || '',
      ...(dueDate ? { dueDate } : {}),
      ...(isCreditPayment !== undefined ? { isCreditPayment } : {}),
      ...(durationMeasure > 0 ? { durationMeasure } : {}),
      ...(paymentMethodCode ? { paymentMethodCode } : {}),
      currency: 'COP',
    },
    items,
    taxes:
      invoiceTaxTotals.length > 0
        ? Array.from(taxesByType, ([type, amount]) => ({
            type,
            amount: toNumber(amount),
          })).filter((tax) => tax.amount > 0)
        : iva > 0
          ? [{ type: 'IVA', amount: iva }]
          : [],
    totals: {
      subtotal,
      total: payable,
      iva,
      ...(discount > 0 ? { discount } : {}),
      ...(globalSurcharge > 0 ? { surcharge: globalSurcharge } : {}),
    },
    ...(result.notes?.trim() ? { observations: result.notes.trim() } : {}),
    ...(withholdings.length > 0 ? { withholdings } : {}),
  };
}
