export type DocumentPreparationNextStep =
  | 'SUPPLIER_REQUIRED'
  | 'ACCOUNT_REQUIRED'
  | 'READY';

export interface DocumentPreparationResult {
  documentId: string;
  nextStep: DocumentPreparationNextStep;
}
