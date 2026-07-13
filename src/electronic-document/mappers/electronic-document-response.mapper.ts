import { ElectronicDocument } from '../entities/electronic-document.entity';
import { ElectronicDocumentResponseDto } from '../dto/electronic-document-response.dto';

export function mapElectronicDocumentToResponse(
  document: ElectronicDocument,
): ElectronicDocumentResponseDto {
  return {
    id: document.id,
    companyId: document.companyId,
    cufe: document.cufe,
    documentNumberThird: document.documentNumberThird,
    documentTypeThird: document.documentTypeThird,
    status: document.status,
    siigoPurchaseId: document.siigoPurchaseId,
    payload: document.payload,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
