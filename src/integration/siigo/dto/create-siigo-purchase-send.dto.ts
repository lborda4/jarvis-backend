import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';
import {
  CreateSiigoSupportDocumentItemDto,
  CreateSiigoSupportDocumentPaymentDto,
  CreateSiigoSupportDocumentRetentionDto,
  CreateSiigoSupportDocumentSupplierDto,
  CreateSiigoSupportDocumentSupplierPreferencesDto,
} from './create-siigo-support-document.dto';

export class CreateSiigoPurchaseSendProviderInvoiceDto {
  prefix: string;
  number: string;
}

export class CreateSiigoPurchaseSendRequestDto {
  documentId: string;
  date: string;
  supplier: CreateSiigoSupportDocumentSupplierDto;
  provider_invoice: CreateSiigoPurchaseSendProviderInvoiceDto;
  observations?: string;
  retentions?: CreateSiigoSupportDocumentRetentionDto[];
  items: CreateSiigoSupportDocumentItemDto[];
  payments: CreateSiigoSupportDocumentPaymentDto[];
  cost_center?: number;
  savePreferences?: boolean;
  supplierPreferences?: CreateSiigoSupportDocumentSupplierPreferencesDto;
}

export class CreateSiigoPurchaseSendResponseDto {
  success: boolean;
  purchase: {
    id: string;
    number?: number;
    name?: string;
    date: string;
    total?: number;
    providerInvoicePrefix?: string;
    providerInvoiceNumber?: string;
  };
  document: ElectronicDocumentResponseDto;
}
