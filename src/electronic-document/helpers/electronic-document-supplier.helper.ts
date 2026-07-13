import { ElectronicDocumentPayload } from '../interfaces/electronic-document-payload.interface';

export interface ResolvedSupplierDocument {
  documentType: string;
  documentNumber: string;
  normalizedDocumentNumber: string;
}

export function resolveSupplierDocumentFromPayload(
  payload: ElectronicDocumentPayload,
): ResolvedSupplierDocument {
  const documentType = payload.supplier.documentType?.trim() || 'NIT';
  const documentNumber = payload.supplier.documentNumber?.trim() || '';
  const normalizedDocumentNumber = documentNumber.replace(/[^\d]/g, '');

  return {
    documentType,
    documentNumber,
    normalizedDocumentNumber,
  };
}
