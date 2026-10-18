import type {
  PurchaseInvoiceDownloadDto,
  PurchaseInvoiceDownloadPartyDto,
} from '../../../electronic-document/dto/purchase-invoice-download.dto';

export type JarvisInvoicePdfParty = PurchaseInvoiceDownloadPartyDto;

export type JarvisInvoicePdfData = PurchaseInvoiceDownloadDto & {
  attachment?: import('../helpers/jarvis-invoice-attachment.helper').InvoiceAttachmentMetadata;
  paymentBreakdown?: import('../dto/create-jarvis-invoice.dto').JarvisInvoicePaymentAllocationDto[];
  sellers?: Array<{ id: string; name: string }>;
  documentKind?: string | null;
  logoDataUrl?: string | null;
};
