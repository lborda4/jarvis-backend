import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class ValidateAccountMappingRequestDto {
  documentId: string;
}

export class ValidateAccountMappingResponseDto {
  status: string;
  document?: ElectronicDocumentResponseDto;
  accountCode?: string;
  accountDescription?: string;
}
