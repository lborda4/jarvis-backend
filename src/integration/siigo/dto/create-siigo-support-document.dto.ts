import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';
import {
  SaveSupplierCostCenterPreferenceDto,
  SaveSupplierPaymentMethodPreferenceDto,
  SaveSupplierRetentionPreferenceDto,
} from './save-account-mapping.dto';

export class CreateSiigoSupportDocumentSupplierDto {
  identification: string;
  branch_office?: number;
}

export class CreateSiigoSupportDocumentReceiptNumberDto {
  prefix: string;
  number: string;
}

export class CreateSiigoSupportDocumentItemTaxDto {
  id: number;
}

export class CreateSiigoSupportDocumentRetentionDto {
  id: number;
  type?: string;
}

export class CreateSiigoSupportDocumentItemDto {
  type?: string;
  code: string;
  description?: string;
  quantity: number;
  price: number;
  discount?: number;
  taxes?: CreateSiigoSupportDocumentItemTaxDto[];
}

export class CreateSiigoSupportDocumentPaymentDto {
  id: number;
  value: number;
  due_date?: string;
}

export class CreateSiigoSupportDocumentStampDto {
  send: boolean;
}

export class CreateSiigoSupportDocumentSupplierPreferencesDto {
  accountDescription?: string;
  paymentMethod?: SaveSupplierPaymentMethodPreferenceDto;
  retentions?: SaveSupplierRetentionPreferenceDto[];
  costCenter?: SaveSupplierCostCenterPreferenceDto;
}

export class CreateSiigoSupportDocumentRequestDto {
  documentId: string;
  date: string;
  supplier: CreateSiigoSupportDocumentSupplierDto;
  supplier_receipt_number: CreateSiigoSupportDocumentReceiptNumberDto;
  observations?: string;
  stamp?: CreateSiigoSupportDocumentStampDto;
  retentions?: CreateSiigoSupportDocumentRetentionDto[];
  items: CreateSiigoSupportDocumentItemDto[];
  payments: CreateSiigoSupportDocumentPaymentDto[];
  cost_center?: number;
  supplierPreferences?: CreateSiigoSupportDocumentSupplierPreferencesDto;
}

export class CreateSiigoSupportDocumentResponseDto {
  success: boolean;
  supportDocument: {
    id: string;
    number?: number;
    name?: string;
    date: string;
    total?: number;
    receiptPrefix?: string;
    receiptNumber?: string;
  };
  document: ElectronicDocumentResponseDto;
}
