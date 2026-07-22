import { BadRequestException } from '@nestjs/common';
import {
  SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE,
  SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT,
  SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED,
} from '../constants/siigo.constants';
import {
  SiigoCachedPaymentTypeCatalogItem,
  SiigoCachedTaxCatalogItem,
  SiigoCatalogCache,
} from '../../interfaces/siigo-catalog-cache.interface';

export interface SiigoSupportDocumentConfig {
  documentId: number;
  paymentTypeId: number;
  defaultTaxId: number;
  sendStamp: boolean;
}

export interface SiigoPurchaseConfig {
  documentId: number;
  purchaseNumber?: number;
  paymentTypeId: number;
  defaultTaxId: number;
}

function isValidConfigurationNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeTaxType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function pickDefaultIvaTaxId(
  taxes: SiigoCachedTaxCatalogItem[],
  companyId?: string,
): number {
  const ivaTax = taxes.find(
    (tax) => normalizeTaxType(tax.type) === 'iva' && tax.active !== false,
  );

  if (!ivaTax) {
    const companySuffix = companyId ? ` para la empresa ${companyId}` : '';

    throw new BadRequestException(
      `No se encontró un impuesto IVA activo en SIIGO${companySuffix}.`,
    );
  }

  return ivaTax.id;
}

export function pickDefaultPaymentTypeId(
  paymentTypes: SiigoCachedPaymentTypeCatalogItem[],
  documentType: string,
  companyId?: string,
): number {
  const normalizedDocumentType = documentType.trim().toUpperCase();
  const matchingPaymentTypes = paymentTypes.filter(
    (paymentType) =>
      paymentType.documentType.trim().toUpperCase() === normalizedDocumentType,
  );
  const selectedPaymentType = matchingPaymentTypes[0];

  if (!selectedPaymentType) {
    const companySuffix = companyId ? ` para la empresa ${companyId}` : '';

    throw new BadRequestException(
      `No se encontraron medios de pago activos en SIIGO para ${normalizedDocumentType}${companySuffix}.`,
    );
  }

  return selectedPaymentType.id;
}

function listPaymentTypesFromCatalog(
  catalog: SiigoCatalogCache,
): SiigoCachedPaymentTypeCatalogItem[] {
  return Object.values(catalog.paymentTypes ?? {}).flat();
}

export function buildSiigoSupportDocumentConfig(
  catalog: SiigoCatalogCache,
  supportDocumentId: number,
  companyId?: string,
): SiigoSupportDocumentConfig {
  if (!isValidConfigurationNumber(supportDocumentId)) {
    throw new BadRequestException(
      `No se pudo resolver el id de Documento Soporte${companyId ? ` para la empresa ${companyId}` : ''}.`,
    );
  }

  const taxes = catalog.taxes ?? [];
  const paymentTypes = listPaymentTypesFromCatalog(catalog);

  return {
    documentId: supportDocumentId,
    paymentTypeId: pickDefaultPaymentTypeId(
      paymentTypes,
      SIIGO_PAYMENT_DOCUMENT_TYPE_SUPPORT,
      companyId,
    ),
    defaultTaxId: pickDefaultIvaTaxId(taxes, companyId),
    sendStamp: SIIGO_SUPPORT_DOCUMENT_SEND_STAMP_ENABLED,
  };
}

export function buildSiigoPurchaseConfig(
  catalog: SiigoCatalogCache,
  purchaseDocumentId: number,
  companyId?: string,
): SiigoPurchaseConfig {
  if (!isValidConfigurationNumber(purchaseDocumentId)) {
    throw new BadRequestException(
      `No se pudo resolver el id de factura de compra${companyId ? ` para la empresa ${companyId}` : ''}.`,
    );
  }

  const taxes = catalog.taxes ?? [];
  const paymentTypes = listPaymentTypesFromCatalog(catalog);

  return {
    documentId: purchaseDocumentId,
    paymentTypeId: pickDefaultPaymentTypeId(
      paymentTypes,
      SIIGO_PAYMENT_DOCUMENT_TYPE_PURCHASE,
      companyId,
    ),
    defaultTaxId: pickDefaultIvaTaxId(taxes, companyId),
  };
}
