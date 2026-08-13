import { ElectronicDocumentResponseDto } from '../../../electronic-document/dto/electronic-document-response.dto';

export class DeleteSiigoPurchaseResponseDto {
  success: boolean;
  siigoPurchaseId: string;
  document: ElectronicDocumentResponseDto;
}
