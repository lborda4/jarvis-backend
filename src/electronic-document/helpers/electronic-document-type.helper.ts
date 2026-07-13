import { BadRequestException } from '@nestjs/common';
import { ElectronicDocumentType } from '../enums/electronic-document-type.enum';

const VALID_TYPES = new Set<string>(Object.values(ElectronicDocumentType));

export function parseElectronicDocumentType(
  value: unknown,
): ElectronicDocumentType {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new BadRequestException(
      'El campo electronicDocumentType es obligatorio.',
    );
  }

  if (!VALID_TYPES.has(normalized)) {
    throw new BadRequestException(
      `El campo electronicDocumentType debe ser uno de: ${Object.values(ElectronicDocumentType).join(', ')}.`,
    );
  }

  return normalized as ElectronicDocumentType;
}

export function parseOptionalElectronicDocumentTypeFilter(
  value: unknown,
): ElectronicDocumentType | undefined {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return undefined;
  }

  if (!VALID_TYPES.has(normalized)) {
    throw new BadRequestException(
      `El parámetro electronicDocumentType debe ser uno de: ${Object.values(ElectronicDocumentType).join(', ')}.`,
    );
  }

  return normalized as ElectronicDocumentType;
}
