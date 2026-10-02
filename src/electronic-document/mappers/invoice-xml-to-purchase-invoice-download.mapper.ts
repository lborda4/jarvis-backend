import { BadGatewayException } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  PurchaseInvoiceDownloadDto,
  PurchaseInvoiceDownloadPartyDto,
} from '../dto/purchase-invoice-download.dto';
import {
  buildDianCatalogQrUrl,
  buildDianInvoiceQrText,
} from '../helpers/dian-invoice-qr.helper';
import { resolveDianPaymentMethodName } from '../helpers/dian-payment-method.helper';

type Node = Record<string, unknown>;
const list = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];
function at(value: unknown, path: string): unknown {
  for (const key of path.split('.')) {
    if (Array.isArray(value)) value = value[0];
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Node)[key];
  }
  return value;
}
function text(value: unknown): string | null {
  if (Array.isArray(value)) return text(value[0]);
  if (value && typeof value === 'object') return text((value as Node)['#text']);
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim() || null
    : null;
}
const str = (node: unknown, path: string) => text(at(node, path));
function amount(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed))
    throw new BadGatewayException('El XML contiene un importe invalido.');
  return parsed;
}
const num = (node: unknown, path: string) => amount(at(node, path));
function parse(xml: string): Node {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new BadGatewayException('NextPyme devolvio un XML invalido.');
  }
  try {
    return new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    }).parse(xml) as Node;
  } catch {
    throw new BadGatewayException('No se pudo leer el XML de NextPyme.');
  }
}
function invoiceFromXml(xml: string): Node {
  let root = parse(xml);
  // AttachedDocument wraps the signed Invoice in a CDATA Description.
  if (!root.Invoice && root.AttachedDocument) {
    const embedded = str(
      root.AttachedDocument,
      'Attachment.ExternalReference.Description',
    );
    if (embedded) root = parse(embedded);
  }
  if (
    !root.Invoice ||
    typeof root.Invoice !== 'object' ||
    Array.isArray(root.Invoice)
  ) {
    throw new BadGatewayException(
      'El XML recibido no contiene una factura de compra.',
    );
  }
  return root.Invoice as Node;
}
function party(value: unknown): PurchaseInvoiceDownloadPartyDto {
  const p = at(value, 'Party');
  const tax = at(p, 'PartyTaxScheme');
  const legal = at(p, 'PartyLegalEntity');
  const address =
    at(p, 'PhysicalLocation.Address') ??
    at(p, 'PostalAddress') ??
    at(tax, 'RegistrationAddress');
  const id =
    at(tax, 'CompanyID') ??
    at(legal, 'CompanyID') ??
    at(p, 'PartyIdentification.ID');
  const scheme = str(id, '@_schemeName');
  return {
    name:
      str(legal, 'RegistrationName') ??
      str(tax, 'RegistrationName') ??
      str(p, 'PartyName.Name'),
    tradeName: str(p, 'PartyName.Name'),
    documentType: scheme === '31' ? 'NIT' : scheme,
    contributorType:
      str(value, 'AdditionalAccountID') === '1'
        ? 'Persona Juridica'
        : str(value, 'AdditionalAccountID') === '2'
          ? 'Persona Natural'
          : str(value, 'AdditionalAccountID'),
    fiscalRegime:
      list(tax)
        .map((t) => str(t, 'TaxLevelCode'))
        .filter(Boolean)
        .join('; ') || null,
    taxResponsibility:
      list(tax)
        .map((t) =>
          [str(t, 'TaxScheme.ID'), str(t, 'TaxScheme.Name')]
            .filter(Boolean)
            .join(' - '),
        )
        .filter(Boolean)
        .join('; ') || null,
    economicActivity: str(p, 'IndustryClassificationCode'),
    documentNumber: text(id),
    checkDigit: str(id, '@_schemeID'),
    address:
      list(at(address, 'AddressLine'))
        .map((line) => str(line, 'Line'))
        .filter(Boolean)
        .join(', ') || str(address, 'StreetName'),
    phone: str(p, 'Contact.Telephone'),
    email: str(p, 'Contact.ElectronicMail'),
    countryName:
      str(address, 'Country.Name') ??
      str(address, 'Country.IdentificationCode'),
    departmentName: str(address, 'CountrySubentity'),
    cityName: str(address, 'CityName'),
  };
}
function taxRows(node: unknown, key = 'TaxTotal') {
  return list(at(node, key))
    .flatMap((total) => list(at(total, 'TaxSubtotal')))
    .map((row) => ({
      code: str(row, 'TaxCategory.TaxScheme.ID') ?? '',
      name:
        str(row, 'TaxCategory.TaxScheme.Name') ??
        str(row, 'TaxCategory.TaxScheme.ID') ??
        '',
      percentage: num(row, 'TaxCategory.Percent'),
      amount: num(row, 'TaxAmount') ?? 0,
    }));
}
function adjustment(node: unknown, charge: boolean): number | null {
  const entries = list(at(node, 'AllowanceCharge')).filter((row) => {
    const indicator = str(row, 'ChargeIndicator');
    return charge
      ? indicator === 'true' || indicator === '1'
      : indicator === 'false' || indicator === '0';
  });
  return entries.length
    ? entries.reduce<number>((sum, row) => sum + (num(row, 'Amount') ?? 0), 0)
    : null;
}

/** All visual data comes from the original UBL, never from the accounting draft/payload. */
export function mapInvoiceXmlToPurchaseInvoiceDownload(
  xml: string,
  id: string,
  expectedCufe: string,
): PurchaseInvoiceDownloadDto {
  const invoice = invoiceFromXml(xml);
  const cufe = str(invoice, 'UUID');
  if (!cufe || cufe.toLowerCase() !== expectedCufe.trim().toLowerCase()) {
    throw new BadGatewayException(
      'El CUFE del XML no corresponde a la factura solicitada.',
    );
  }
  const subtotal = num(invoice, 'LegalMonetaryTotal.LineExtensionAmount');
  const total = num(invoice, 'LegalMonetaryTotal.PayableAmount');
  const lines = list(invoice.InvoiceLine);
  if (
    !str(invoice, 'ID') ||
    subtotal === null ||
    total === null ||
    !lines.length
  ) {
    throw new BadGatewayException(
      'El XML de la factura esta incompleto: faltan numero, items o totales.',
    );
  }
  const taxes = taxRows(invoice);
  const withholdings = taxRows(invoice, 'WithholdingTaxTotal').map((t) => ({
    dianTaxCode: t.code,
    name: t.name,
    percentage: t.percentage ?? 0,
    amount: t.amount,
  }));
  const iva = taxes
    .filter((t) => t.code === '01')
    .reduce((sum, t) => sum + t.amount, 0);
  const payment = at(invoice, 'PaymentMeans');
  const extensions = list(at(invoice, 'UBLExtensions.UBLExtension'))
    .map((ext) => at(ext, 'ExtensionContent.DianExtensions'))
    .filter(Boolean);
  const qr = extensions.map((ext) => str(ext, 'QRCode')).find(Boolean);
  const issuer = party(invoice.AccountingSupplierParty);
  const buyer = party(invoice.AccountingCustomerParty);
  const invoiceNumber = str(invoice, 'ID');
  const issueDate = str(invoice, 'IssueDate');
  const paymentId = str(payment, 'ID');
  const control = extensions
    .map((ext) => at(ext, 'InvoiceControl'))
    .find(Boolean);
  const referenceKinds = [
    ['ReceiptDocumentReference', 'Aviso de Recibo'],
    ['DespatchDocumentReference', 'Aviso de Despacho'],
    ['AdditionalDocumentReference', 'Documento adicional'],
    ['BillingReference', 'Factura relacionada'],
  ] as const;
  return {
    id,
    cufe,
    invoiceNumber,
    issueTime: str(invoice, 'IssueTime'),
    operationType: str(invoice, 'CustomizationID'),
    orderNumber: str(invoice, 'OrderReference.ID'),
    orderDate: str(invoice, 'OrderReference.IssueDate'),
    exchangeRate: num(invoice, 'PaymentExchangeRate.CalculationRate'),
    prepaidAmount: num(invoice, 'LegalMonetaryTotal.PrepaidAmount'),
    taxExclusiveAmount: num(invoice, 'LegalMonetaryTotal.TaxExclusiveAmount'),
    taxInclusiveAmount: num(invoice, 'LegalMonetaryTotal.TaxInclusiveAmount'),
    technologyProviderId:
      extensions
        .map((ext) => str(ext, 'SoftwareProvider.ProviderID'))
        .find(Boolean) ?? null,
    references: referenceKinds.flatMap(([key, label]) =>
      list(invoice[key]).map((ref) => {
        const node =
          key === 'BillingReference'
            ? at(ref, 'InvoiceDocumentReference')
            : ref;
        return {
          type: str(node, 'DocumentType') ?? label,
          number: str(node, 'ID'),
          date: str(node, 'IssueDate'),
        };
      }),
    ),
    authorization: {
      number: str(control, 'InvoiceAuthorization'),
      from: str(control, 'AuthorizedInvoices.From'),
      to: str(control, 'AuthorizedInvoices.To'),
      startDate: str(control, 'AuthorizationPeriod.StartDate'),
      endDate: str(control, 'AuthorizationPeriod.EndDate'),
    },
    prefix:
      extensions
        .map((ext) => str(ext, 'InvoiceControl.AuthorizedInvoices.Prefix'))
        .find(Boolean) ?? null,
    issueDate,
    dueDate: str(invoice, 'DueDate') ?? str(payment, 'PaymentDueDate'),
    isCreditPayment:
      paymentId === '2' ? true : paymentId === '1' ? false : null,
    paymentMethodName: resolveDianPaymentMethodName(
      str(payment, 'PaymentMeansCode'),
    ),
    currency: str(invoice, 'DocumentCurrencyCode') ?? 'COP',
    observations:
      list(invoice.Note).map(text).filter(Boolean).join('\n') || null,
    issuer,
    buyer,
    items: lines.map((line) => {
      const vat = taxRows(line).filter((t) => t.code === '01');
      const inc = taxRows(line).filter((t) => t.code === '04');
      const quantity = num(line, 'InvoicedQuantity');
      const price = num(line, 'Price.PriceAmount');
      const lineTotal = num(line, 'LineExtensionAmount');
      if (quantity === null || price === null || lineTotal === null) {
        throw new BadGatewayException(
          'El XML contiene un item sin cantidad, precio o total.',
        );
      }
      const lineWithholdings = taxRows(line, 'WithholdingTaxTotal').map((t) => ({
        dianTaxCode: t.code,
        name: t.name,
        percentage: t.percentage ?? 0,
        amount: t.amount,
      }));
      const lineCodes = new Set(
        lineWithholdings.map((row) => row.dianTaxCode).filter(Boolean),
      );
      // NextPyme manda WithholdingTaxTotal solo a nivel factura. La línea
      // hereda la tarifa para el PDF; el monto se deja en null para no
      // restarlo otra vez del valor total de la línea.
      const inheritedWithholdings = withholdings
        .filter((row) => row.dianTaxCode && !lineCodes.has(row.dianTaxCode))
        .map((row) => ({ ...row, amount: null }));
      return {
        name: str(line, 'Item.Name'),
        taxes: taxRows(line).map(t => ({ type: t.name, amount: t.amount })),
        withholdings: [...lineWithholdings, ...inheritedWithholdings],
        description:
          list(at(line, 'Item.Description'))
            .map(text)
            .filter(Boolean)
            .join('\n') ||
          str(line, 'Item.Name') ||
          '',
        code:
          str(line, 'Item.SellersItemIdentification.ID') ??
          str(line, 'Item.StandardItemIdentification.ID'),
        quantity,
        // Display the issuer's declared PriceAmount verbatim in the representation.
        unitValue: price,
        unitCode: str(line, 'InvoicedQuantity.@_unitCode'),
        incAmount: inc.length
          ? inc.reduce((sum, t) => sum + t.amount, 0)
          : null,
        incPercentage: inc.length === 1 ? inc[0].percentage : null,
        discount: adjustment(line, false),
        surcharge: adjustment(line, true),
        ivaPercentage: vat.length === 1 ? vat[0].percentage : null,
        ivaAmount: vat.length
          ? vat.reduce((sum, t) => sum + t.amount, 0)
          : null,
        total: lineTotal,
      };
    }),
    taxes: taxes.map((t) => ({
      type:
        t.code === '01'
          ? 'IVA'
          : t.code === '04'
            ? 'INC'
            : t.code === '22'
              ? 'Bolsas'
              : t.name,
      amount: t.amount,
    })),
    subtotal,
    iva,
    total,
    discount:
      num(invoice, 'LegalMonetaryTotal.AllowanceTotalAmount') ??
      adjustment(invoice, false),
    surcharge:
      num(invoice, 'LegalMonetaryTotal.ChargeTotalAmount') ??
      adjustment(invoice, true),
    withholdings,
    dianQrUrl: buildDianCatalogQrUrl(cufe),
    dianQrText:
      qr ??
      buildDianInvoiceQrText({
        cufe,
        invoiceNumber: invoiceNumber!,
        issueDate,
        issueTime: str(invoice, 'IssueTime'),
        issuerNit: issuer.documentNumber ?? '',
        buyerNit: buyer.documentNumber ?? '',
        subtotal,
        iva,
        total,
      }),
  };
}
