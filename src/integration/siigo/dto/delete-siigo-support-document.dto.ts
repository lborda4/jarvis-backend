import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class DeleteSiigoSupportDocumentResponseDto {
  success: boolean;
  siigoSupportDocumentId: string;
  document: ElectronicDocumentResponseDto;
}
