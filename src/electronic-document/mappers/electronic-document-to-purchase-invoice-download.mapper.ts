import { Company } from '../../company/entities/company.entity';
import { PurchaseInvoiceDownloadDto } from '../dto/purchase-invoice-download.dto';
import { ElectronicDocument } from '../entities/electronic-document.entity';
import { resolveCountryName } from '../helpers/dian-location.helper';
import { resolveDianPaymentMethodName } from '../helpers/dian-payment-method.helper';
import {
  buildDianCatalogQrUrl,
  buildDianInvoiceQrText,
} from '../helpers/dian-invoice-qr.helper';
import type {
  ElectronicDocumentSupplier,
  ElectronicDocumentWithholding,
} from '../interfaces/electronic-document-payload.interface';

const DIAN_WITHHOLDING_NAME: Record<string, string> = {
  '05': 'ReteIVA',
  '06': 'ReteFuente',
  '07': 'ReteICA',
};

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function mapWithholding(
  withholding: ElectronicDocumentWithholding,
  subtotal: number,
) {
  const dianTaxCode = withholding.dianTaxCode.trim();
  const certifiedAmount =
    withholding.amount && withholding.amount > 0 ? withholding.amount : null;

  return {
    dianTaxCode,
    name: DIAN_WITHHOLDING_NAME[dianTaxCode] ?? `Retención ${dianTaxCode}`,
    percentage: withholding.percentage,
    amount:
      certifiedAmount ??
      (withholding.percentage > 0
        ? Math.round(subtotal * (withholding.percentage / 100) * 100) / 100
        : null),
  };
}

function mapParty(
  party: ElectronicDocumentSupplier | undefined,
  fallback?: {
    name?: string | null;
    documentNumber?: string | null;
    documentType?: string | null;
    cityName?: string | null;
  },
) {
  return {
    name: emptyToNull(party?.name) ?? emptyToNull(fallback?.name),
    tradeName:
      emptyToNull(party?.commercialName) ?? emptyToNull(party?.name),
    documentType:
      emptyToNull(party?.documentType) ??
      emptyToNull(fallback?.documentType),
    documentNumber:
      emptyToNull(party?.documentNumber) ??
      emptyToNull(fallback?.documentNumber),
    checkDigit: emptyToNull(party?.checkDigit),
    address: emptyToNull(party?.address),
    phone: emptyToNull(party?.phone),
    email: emptyToNull(party?.email),
    countryName:
      emptyToNull(party?.countryName) ??
      resolveCountryName(party?.countryCode),
    departmentName: emptyToNull(party?.stateName),
    cityName:
      emptyToNull(party?.cityName) ?? emptyToNull(fallback?.cityName),
  };
}

export function mapElectronicDocumentToPurchaseInvoiceDownload(
  document: ElectronicDocument,
  company: Company,
): PurchaseInvoiceDownloadDto {
  const payload = document.payload;
  const supplier = payload.supplier;
  const invoice = payload.invoice;
  const totals = payload.totals;
  const cufe = document.cufe?.trim() || invoice.cufe?.trim() || '';
  const invoiceNumber = emptyToNull(invoice.number);
  const issuerNit =
    emptyToNull(document.documentNumberThird) ??
    emptyToNull(supplier.documentNumber) ??
    '';
  const buyerNit =
    emptyToNull(payload.buyer?.documentNumber) ??
    emptyToNull(company.nit) ??
    '';
  const subtotal = Number(totals.subtotal ?? 0);
  const iva = Number(totals.iva ?? 0);
  const total = Number(totals.total ?? 0);

  return {
    id: document.id,
    cufe,
    invoiceNumber,
    prefix: emptyToNull(invoice.prefix),
    issueDate: emptyToNull(invoice.issueDate),
    dueDate: emptyToNull(invoice.dueDate),
    isCreditPayment:
      invoice.isCreditPayment === undefined ? null : invoice.isCreditPayment,
    paymentMethodName: resolveDianPaymentMethodName(invoice.paymentMethodCode),
    currency: emptyToNull(invoice.currency) ?? 'COP',
    observations: emptyToNull(payload.observations),
    issuer: mapParty(
      {
        ...supplier,
        documentNumber: issuerNit,
        documentType:
          emptyToNull(document.documentTypeThird) ?? supplier.documentType,
      },
    ),
    buyer: mapParty(payload.buyer, {
      name: company.name,
      documentNumber: buyerNit,
      documentType: 'NIT',
      cityName: company.cityName,
    }),
    items: (payload.items ?? []).map((item) => {
      const ivaPercentage =
        item.ivaPercentage === undefined ? null : item.ivaPercentage;
      const ivaAmount =
        ivaPercentage == null
          ? null
          : Math.round(item.total * (ivaPercentage / 100) * 100) / 100;

      return {
        description: item.descripcion?.trim() || 'Ítem',
        code: emptyToNull(item.codigo),
        quantity: item.cantidad,
        unitValue: item.valorUnitario,
        discount: item.discount && item.discount > 0 ? item.discount : null,
        surcharge: item.surcharge && item.surcharge > 0 ? item.surcharge : null,
        ivaPercentage,
        ivaAmount,
        total: item.total,
      };
    }),
    taxes: (payload.taxes ?? []).map((tax) => ({
      type: tax.type,
      amount: tax.amount,
    })),
    subtotal,
    iva,
    discount: totals.discount && totals.discount > 0 ? totals.discount : null,
    surcharge: totals.surcharge && totals.surcharge > 0 ? totals.surcharge : null,
    total,
    withholdings: (payload.withholdings ?? []).map((withholding) =>
      mapWithholding(withholding, subtotal),
    ),
    dianQrUrl: buildDianCatalogQrUrl(cufe),
    dianQrText: buildDianInvoiceQrText({
      invoiceNumber: invoiceNumber ?? cufe.slice(0, 12),
      issueDate: emptyToNull(invoice.issueDate),
      issuerNit,
      buyerNit,
      subtotal,
      iva,
      total,
      cufe,
    }),
  };
}
