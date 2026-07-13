import { BadGatewayException } from '@nestjs/common';
import { SiigoDocumentType } from '../interfaces/siigo-api.interface';

export function pickSiigoDocumentType(
  documentTypes: SiigoDocumentType[],
  expectedType: string,
): SiigoDocumentType | undefined {
  if (!documentTypes.length) {
    return undefined;
  }

  const normalizedType = expectedType.trim().toUpperCase();

  return (
    documentTypes.find(
      (documentType) =>
        documentType.type?.trim().toUpperCase() === normalizedType,
    ) ??
    documentTypes.find(
      (documentType) =>
        documentType.code?.trim().toUpperCase() === normalizedType,
    ) ??
    documentTypes[0]
  );
}

export function pickSiigoDocumentTypeId(
  documentTypes: SiigoDocumentType[],
  expectedType: string,
  label: string,
): number {
  const documentType = pickSiigoDocumentType(documentTypes, expectedType);

  if (!documentType?.id) {
    throw new BadGatewayException(
      `SIIGO no devolvió un tipo de documento válido para ${label} (${expectedType}).`,
    );
  }

  return documentType.id;
}

export function isValidSiigoConfigurationId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
