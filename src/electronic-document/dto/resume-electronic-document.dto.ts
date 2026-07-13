import { ElectronicDocumentListItemDto } from './electronic-document-list-item.dto';

export class ResumeElectronicDocumentRequestDto {
  documentId: string;
}

export class ResumeElectronicDocumentResponseDto {
  nextStep:
    | 'SUPPLIER_REQUIRED'
    | 'ACCOUNT_REQUIRED'
    | 'COMPLETED'
    | 'FAILED';
  message?: string;
  document: ElectronicDocumentListItemDto;
}
