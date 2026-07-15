import { ResumeElectronicDocumentResponseDto } from './resume-electronic-document.dto';

export class ResumeElectronicDocumentsBatchRequestDto {
  documentIds: string[];
  prepareOnly?: boolean;
}

export class ResumeElectronicDocumentsBatchResponseDto {
  items: ResumeElectronicDocumentResponseDto[];
}
