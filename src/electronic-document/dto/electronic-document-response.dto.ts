import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

export class ElectronicDocumentResponseDto {
  id: string;
  companyId: string;
  cufe: string | null;
  documentNumberThird: string | null;
  documentTypeThird: string | null;
  status: string;
  siigoPurchaseId: string | null;
  siigoDocumentNumber: number | null;
  payload: ElectronicDocumentPayload;
  createdAt: string;
  updatedAt: string;
}
