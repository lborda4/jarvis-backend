import type { DataSource } from 'typeorm';
import type { PurchaseInvoiceDownloadPartyDto } from '../../../electronic-document/dto/purchase-invoice-download.dto';
import type { JarvisCredentials } from '../../interfaces/integration-credentials.interface';
import type { CreateJarvisInvoiceItemDto } from '../dto/create-jarvis-invoice.dto';

export interface JarvisIssuedSnapshot {
  issuer: PurchaseInvoiceDownloadPartyDto;
  buyer: PurchaseInvoiceDownloadPartyDto;
  items: Array<{ code: string | null; description: string; name: string }>;
}
const party = (fields: Partial<PurchaseInvoiceDownloadPartyDto>): PurchaseInvoiceDownloadPartyDto => ({
  name: null, tradeName: null, documentType: null, documentNumber: null, checkDigit: null,
  address: null, phone: null, email: null, countryName: null, departmentName: null, cityName: null, ...fields,
});

/** Capture before calling the issuer. Never look up mutable catalogs when reading an issued document. */
export async function captureIssuedSnapshot(source: DataSource, input: {
  companyId: string;
  company: { nit: string; name: string };
  credentials: JarvisCredentials;
  buyer: Partial<PurchaseInvoiceDownloadPartyDto>;
  items: CreateJarvisInvoiceItemDto[];
}): Promise<JarvisIssuedSnapshot> {
  const codes = [...new Set(input.items.map(item => item.code?.trim()).filter((code): code is string => Boolean(code)))];
  const products: Array<{ sku: string; name: string }> = codes.length
    ? await source.query('SELECT sku, name FROM products WHERE company_id=$1 AND sku=ANY($2::text[])', [input.companyId, codes])
    : [];
  const names = new Map(products.map(product => [product.sku, product.name]));
  const c = input.credentials;
  return {
    issuer: party({ name: c.business_name || input.company.name || null, tradeName: c.trade_name || c.business_name || null,
      documentType: 'NIT', documentNumber: input.company.nit || null, address: c.address || null, phone: c.phone || null,
      email: c.email || null, countryName: c.country || null, departmentName: c.department || null,
      cityName: c.city || c.municipality || null, economicActivity: c.economic_activity || null, fiscalRegime: c.tax_responsibility || null }),
    buyer: party(input.buyer),
    items: input.items.map(item => ({ code: item.code?.trim() || null, description: item.description,
      name: names.get(item.code?.trim() || '') || item.description })),
  };
}

export function issuedItemName(snapshot: JarvisIssuedSnapshot | undefined, index: number, item: { code?: string | null; description: string }) {
  const saved = snapshot?.items?.[index];
  return saved && (saved.code && item.code?.trim() ? saved.code === item.code.trim() : saved.description === item.description)
    ? saved.name : undefined;
}
