export class DeleteElectronicDocumentsBatchRequestDto {
  documentIds: string[];
}

export class DeleteElectronicDocumentsBatchResponseDto {
  deletedIds: string[];
  skippedIds: string[];
}
