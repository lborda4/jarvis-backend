export class ResumeElectronicDocumentsBatchRequestDto {
  documentIds: string[];
  prepareOnly?: boolean;
}

/** El endpoint responde apenas encola el lote — ya no espera a que
 * termine (ver SiigoDocumentResumeService.resumeBatchInBackground). El
 * progreso real se lee con polling de GET /electronic-documents, no de
 * esta respuesta. */
export class ResumeElectronicDocumentsBatchResponseDto {
  accepted: boolean;
}
