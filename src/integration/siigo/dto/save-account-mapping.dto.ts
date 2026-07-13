import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class SaveSupplierPaymentMethodPreferenceDto {
  id: number;
  name: string;
  type: string;
  dueDate?: boolean;
}

export class SaveSupplierRetentionPreferenceDto {
  id: number;
  name: string;
  type: string;
  percentage: number;
}

export class SaveAccountMappingRequestDto {
  documentId: string;
  accountCode: string;
  accountDescription: string;
  autoApply: boolean;
  paymentMethod?: SaveSupplierPaymentMethodPreferenceDto;
  retentions?: SaveSupplierRetentionPreferenceDto[];
}

export class SaveAccountMappingResponseDto {
  success: boolean;
  document: ElectronicDocumentResponseDto;
}
