import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class CreateSiigoDocumentRequestDto {
  documentId: string;
}

export class CreateSiigoDocumentResponseDto {
  success: boolean;
  siigoDocument: {
    id: string;
    number?: number;
    name?: string;
    date?: string;
    total?: number;
    receiptPrefix?: string;
    receiptNumber?: string;
  };
  document: ElectronicDocumentResponseDto;
}
