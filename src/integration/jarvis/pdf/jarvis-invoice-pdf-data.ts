import type {
  PurchaseInvoiceDownloadDto,
  PurchaseInvoiceDownloadPartyDto,
} from '../../../electronic-document/dto/purchase-invoice-download.dto';

export type JarvisInvoicePdfParty = PurchaseInvoiceDownloadPartyDto;

export type JarvisInvoicePdfData = PurchaseInvoiceDownloadDto & {
  documentKind?: string | null;
  logoDataUrl?: string | null;
};
