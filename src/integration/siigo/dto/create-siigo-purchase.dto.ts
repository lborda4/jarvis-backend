import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class CreateSiigoPurchaseRequestDto {
  documentId: string;
}

export class CreateSiigoPurchaseResponseDto {
  success: boolean;
  purchase: {
    id: string;
    number?: number;
    name?: string;
    date?: string;
    total?: number;
    providerInvoicePrefix?: string;
    providerInvoiceNumber?: string;
  };
  document: ElectronicDocumentResponseDto;
}
