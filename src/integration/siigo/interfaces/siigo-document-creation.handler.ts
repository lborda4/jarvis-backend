import { ElectronicDocumentType } from '../../../electronic-document/enums/electronic-document-type.enum';
import { CreateSiigoDocumentResponseDto } from '../dto/create-siigo-document.dto';

export interface SiigoDocumentCreationHandler {
  readonly documentType: ElectronicDocumentType;
  create(
    documentId: string,
    companyId: string,
  ): Promise<CreateSiigoDocumentResponseDto>;
}
