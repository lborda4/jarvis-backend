import type {
  PurchaseInvoiceDownloadDto,
  PurchaseInvoiceDownloadPartyDto,
} from '../../../electronic-document/dto/purchase-invoice-download.dto';

export type JarvisInvoicePdfParty = PurchaseInvoiceDownloadPartyDto;

export type JarvisInvoicePdfData = PurchaseInvoiceDownloadDto & {
  sellers?: Array<{ id: string; name: string }>;
  documentKind?: string | null;
  logoDataUrl?: string | null;
};
